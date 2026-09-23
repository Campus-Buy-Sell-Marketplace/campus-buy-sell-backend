import { Pool } from 'pg';

// Create a connection pool to PostgreSQL.
// The DATABASE_URL env var is loaded via -r dotenv/config before this module runs.
const isRemoteDb = 
  process.env.DATABASE_URL?.includes('neon.tech') || 
  process.env.DATABASE_URL?.includes('sslmode=require') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
});

// Log a message when a new connection is acquired
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

// If the pool encounters an idle client error, log it
pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

export default pool;
