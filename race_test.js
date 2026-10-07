/**
 * Race-Condition Test — Two users purchasing the same last item simultaneously
 *
 * This test fires two simultaneous checkout requests for the same product
 * whose stock = 1 and verifies:
 *   • Exactly ONE request succeeds (HTTP 201)
 *   • The other fails with HTTP 400 "Insufficient stock" OR 409 "lock"
 *   • Product stock in the DB ends at exactly 0 (never negative)
 *
 * Run with:  node -r dotenv/config race_test.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const http = require('http');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const backendUrl = process.env.TEST_BACKEND_URL || 'http://localhost:5000';
    const url = new URL(path, backendUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken(email, password) {
  const r = await apiRequest('POST', '/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 Race-condition test starting...\n');

  // 1. Ensure test product exists with stock = 1
  const { rows: sellers } = await pool.query(
    `SELECT id FROM users WHERE role = 'SELLER' LIMIT 1`
  );
  if (!sellers.length) throw new Error('No SELLER user found. Run npm run seed first.');
  const sellerId = sellers[0].id;

  const { rows: [testProduct] } = await pool.query(
    `INSERT INTO products (seller_id, title, description, price, category, condition, stock, is_active)
     VALUES ($1, 'Race Test Widget', 'One left!', 99.99, 'Electronics', 'NEW', 1, TRUE)
     RETURNING id, title, stock`,
    [sellerId]
  );
  console.log(`✅ Test product created: "${testProduct.title}" (stock=${testProduct.stock}) — id=${testProduct.id}`);

  // 2. Login as two different buyers
  const token1 = await getToken('student@campus.edu', 'Password123!');
  const token2 = await getToken('rahul.sharma@campus.edu', 'Password123!');
  console.log('✅ Both buyers authenticated');

  // 3. Fire both checkout requests simultaneously (no await between them)
  const items = [{ productId: testProduct.id, quantity: 1 }];
  console.log('\n🚀 Firing two simultaneous purchase requests...');

  const [result1, result2] = await Promise.all([
    apiRequest('POST', '/api/orders/checkout', { items }, token1),
    apiRequest('POST', '/api/orders/checkout', { items }, token2),
  ]);

  console.log(`\n   Buyer 1 → HTTP ${result1.status}:`, JSON.stringify(result1.body?.message || result1.body));
  console.log(`   Buyer 2 → HTTP ${result2.status}:`, JSON.stringify(result2.body?.message || result2.body));

  // 4. Verify DB stock is exactly 0
  const { rows: [after] } = await pool.query(
    'SELECT stock FROM products WHERE id = $1',
    [testProduct.id]
  );
  console.log(`\n   DB stock after both requests: ${after.stock}`);

  // 5. Assertions
  const statuses = [result1.status, result2.status].sort();
  const successCount = [result1, result2].filter((r) => r.status === 201).length;
  const failCount = [result1, result2].filter((r) => r.status === 400 || r.status === 409).length;

  let passed = true;

  if (successCount !== 1) {
    console.error(`\n❌ FAIL: Expected exactly 1 success, got ${successCount}`);
    passed = false;
  } else {
    console.log('\n✅ Exactly 1 buyer succeeded');
  }

  if (failCount !== 1) {
    console.error(`❌ FAIL: Expected exactly 1 failure, got ${failCount}`);
    passed = false;
  } else {
    console.log('✅ Exactly 1 buyer got an error (stock insufficient / lock contention)');
  }

  if (Number(after.stock) !== 0) {
    console.error(`❌ FAIL: Stock should be 0, but is ${after.stock}`);
    passed = false;
  } else {
    console.log('✅ DB stock is 0 — no negative stock, no double-sell');
  }

  // Clean up: delete order_items → orders → product
  await pool.query(
    `DELETE FROM order_items WHERE product_id = $1`,
    [testProduct.id]
  );
  await pool.query(
    `DELETE FROM orders o
     WHERE NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id)
       AND buyer_id IN (
         SELECT id FROM users WHERE email IN ('student@campus.edu','rahul.sharma@campus.edu')
       )`
  );
  await pool.query('DELETE FROM products WHERE id = $1', [testProduct.id]);
  console.log('\n🧹 Test product and related orders cleaned up');


  console.log(passed ? '\n🎉 ALL TESTS PASSED\n' : '\n💥 SOME TESTS FAILED\n');
  await pool.end();
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test error:', err);
  pool.end();
  process.exit(1);
});
