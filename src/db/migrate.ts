import fs from 'fs';
import path from 'path';
import pool from '../config/db';

async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('\u274c Error: DATABASE_URL is not set in campus-buy-sell-backend/.env');
    console.error('\ud83d\udc49 Please copy .env.example to .env and configure your PostgreSQL connection string.');
    process.exit(1);
  }

  // Apply V1 schema (users, seller_applications)
  const schemaPath = path.join(__dirname, 'schema.sql');
  console.log('\ud83d\udd04 Connecting to PostgreSQL and applying schema...');
  console.log(`\ud83d\udcc4 Reading: ${schemaPath}\n`);

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('\u2705 PostgreSQL schema V1 created successfully!');
    console.log('   - Enum user_role created');
    console.log('   - Table users created');
    console.log('   - Table seller_applications created');
    console.log('   - Indexes and trigger created\n');
  } catch (err: any) {
    console.error('\u274c Failed to apply database schema V1:');
    console.error(err.message || err);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure your PostgreSQL server/service or Docker container is running.');
    console.error('2. Verify the credentials, port (5432), and database name in your .env DATABASE_URL.');
    console.error('3. Make sure the database exists (e.g. CREATE DATABASE campus_marketplace).');
    await pool.end();
    process.exit(1);
  }

  // Apply V2 schema (products & cart)
  const schema2Path = path.join(__dirname, 'schema_v2.sql');
  console.log('\ud83d\udd04 Applying schema V2 (products & cart)...');
  try {
    const sql2 = fs.readFileSync(schema2Path, 'utf8');
    await pool.query(sql2);
    console.log('\u2705 Schema V2 applied successfully!');
    console.log('   - Table products created');
    console.log('   - Table cart_items created\n');
  } catch (err: any) {
    console.error('\u274c Failed to apply schema V2:');
    console.error(err.message || err);
    await pool.end();
    process.exit(1);
  }

  // Apply V3 schema (orders & order_items)
  const schema3Path = path.join(__dirname, 'schema_v3.sql');
  console.log('\ud83d\udd04 Applying schema V3 (orders)...');
  try {
    const sql3 = fs.readFileSync(schema3Path, 'utf8');
    await pool.query(sql3);
    console.log('\u2705 Schema V3 applied successfully!');
    console.log('   - Table orders created');
    console.log('   - Table order_items created\n');
  } catch (err: any) {
    console.error('\u274c Failed to apply schema V3:');
    console.error(err.message || err);
    await pool.end();
    process.exit(1);
  }

  // Apply V4 schema (user_preferences & wishlist_items)
  const schema4Path = path.join(__dirname, 'schema_v4.sql');
  try {
    const sql4 = fs.readFileSync(schema4Path, 'utf8');
    await pool.query(sql4);
    console.log('✅ Schema V4 applied successfully!');
    console.log('   - Table user_preferences created');
    console.log('   - Table wishlist_items created\n');
  } catch (err: any) {
    console.error('❌ Failed to apply schema V4:');
    console.error(err.message || err);
    await pool.end();
    process.exit(1);
  }

  await pool.end();
}

migrate();
