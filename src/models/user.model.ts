import pool from '../config/db';
import { User, CreateUserData } from '../types';

/**
 * Find a user by their email address.
 * Returns null if not found.
 */
export async function findByEmail(email: string): Promise<User | null> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a user by their ID (without the password field).
 * Used after JWT verification to return user details.
 */
export async function findById(id: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT id, name, email, role, google_id, avatar_url, created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Find a user by their Google account ID.
 * Returns null if no account is linked to this Google ID.
 */
export async function findByGoogleId(googleId: string): Promise<User | null> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE google_id = $1',
    [googleId]
  );
  return result.rows[0] ?? null;
}

/**
 * Create a new user in the database.
 * Returns the created user (without the password).
 */
export async function createUser(data: CreateUserData): Promise<User> {
  const result = await pool.query<User>(
    `INSERT INTO users (name, email, password, google_id, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, google_id, avatar_url, created_at, updated_at`,
    [
      data.name,
      data.email,
      data.password ?? null,
      data.google_id ?? null,
      data.avatar_url ?? null,
    ]
  );
  return result.rows[0];
}
