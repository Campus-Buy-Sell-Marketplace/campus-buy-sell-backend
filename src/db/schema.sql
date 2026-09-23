-- ============================================================
-- Campus Marketplace — PostgreSQL Schema
-- Run this file against your PostgreSQL database to set up
-- the tables needed for authentication.
--
-- How to run:
--   psql -U postgres -d campus_marketplace -f src/db/schema.sql
-- ============================================================

-- Create the role enum type (only runs if it doesn't exist)
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('STUDENT', 'SELLER', 'ADMIN', 'SUPER_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create the users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255)  NOT NULL,
  email       VARCHAR(255)  UNIQUE NOT NULL,
  password    VARCHAR(255),                       -- NULL for Google-only accounts
  role        user_role     NOT NULL DEFAULT 'STUDENT',
  google_id   VARCHAR(255)  UNIQUE,               -- NULL for email/password accounts
  avatar_url  VARCHAR(500),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Speed up lookups by email and google_id
CREATE INDEX IF NOT EXISTS idx_users_email     ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id);

-- Automatically update updated_at on every row update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON users;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
