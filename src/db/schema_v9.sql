-- ============================================================
-- Campus Marketplace — Schema V9: Seller Payout Profiles & Payouts
-- Run after schema_v8.sql
-- ============================================================

-- 1. Seller Payout Profiles Table (Stores seller UPI & bank details)
CREATE TABLE IF NOT EXISTS seller_payout_profiles (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  upi_id               VARCHAR(100) NOT NULL,
  account_holder_name  VARCHAR(150) NOT NULL,
  phone_number         VARCHAR(20),
  bank_name            VARCHAR(100),
  bank_account_number  VARCHAR(50),
  bank_ifsc            VARCHAR(20),
  is_verified          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_payout_profiles_user_id ON seller_payout_profiles(user_id);

DROP TRIGGER IF EXISTS set_seller_payout_profiles_updated_at ON seller_payout_profiles;
CREATE TRIGGER set_seller_payout_profiles_updated_at
  BEFORE UPDATE ON seller_payout_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 2. Seller Payouts Table (Tracks payouts for completed orders)
CREATE TABLE IF NOT EXISTS seller_payouts (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               UUID          NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id              UUID          NOT NULL REFERENCES users(id),
  order_amount           NUMERIC(10,2) NOT NULL CHECK (order_amount >= 0),
  commission_percent     NUMERIC(5,2)  NOT NULL DEFAULT 2.00,
  commission_amount      NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  net_payout_amount      NUMERIC(10,2) NOT NULL CHECK (net_payout_amount >= 0),
  seller_upi_id          VARCHAR(100)  NOT NULL,
  account_holder_name    VARCHAR(150),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'CANCELLED')),
  transaction_reference  VARCHAR(100),
  admin_notes            TEXT,
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_order_seller UNIQUE (order_id, seller_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_payouts_order_id ON seller_payouts(order_id);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller_id ON seller_payouts(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_status ON seller_payouts(status);

DROP TRIGGER IF EXISTS set_seller_payouts_updated_at ON seller_payouts;
CREATE TRIGGER set_seller_payouts_updated_at
  BEFORE UPDATE ON seller_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
