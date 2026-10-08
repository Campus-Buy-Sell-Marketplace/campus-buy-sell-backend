-- ============================================================
-- Campus Marketplace — Schema V5: OTP Delivery Verification
-- Run after schema_v4.sql
-- Adds: delivery OTP, payment method, reserved stock tracking,
--       and PENDING_MEETUP order status.
-- ============================================================

-- 1. Add payment_method column to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(10) NOT NULL DEFAULT 'OFFLINE'
    CHECK (payment_method IN ('OFFLINE', 'ONLINE'));

-- 2. Add delivery_otp column (plain 6-digit string — no hash needed for campus use)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_otp VARCHAR(6);

-- 3. Add otp_verified column
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS otp_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Extend the status check constraint to include new statuses
-- Drop old constraint, re-add with expanded values
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('PENDING_MEETUP', 'COMPLETED', 'CANCELLED', 'PENDING', 'CONFIRMED'));

-- 5. Track reserved stock on products so we know how much is actually available
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS reserved_stock INTEGER NOT NULL DEFAULT 0
    CHECK (reserved_stock >= 0);
