import fs from 'fs';
import path from 'path';
import pool from '../config/db';

async function migrate(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');

  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not set in campus-buy-sell-backend/.env');
    console.error('👉 Please copy .env.example to .env and configure your PostgreSQL connection string.');
    process.exit(1);
  }

  console.log('🔄 Connecting to PostgreSQL and applying schema...');
  console.log(`📄 Reading: ${schemaPath}\n`);

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);

    console.log('✅ PostgreSQL schema created successfully!');
    console.log('   - Enum user_role created');
    console.log('   - Table users created');
    console.log('   - Indexes and trigger created\n');
  } catch (err: any) {
    console.error('❌ Failed to apply database schema:');
    console.error(err.message || err);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure your PostgreSQL server/service or Docker container is running.');
    console.error('2. Verify the credentials, port (5432), and database name in your .env DATABASE_URL.');
    console.error('3. Make sure the database exists (e.g. CREATE DATABASE campus_marketplace).');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
