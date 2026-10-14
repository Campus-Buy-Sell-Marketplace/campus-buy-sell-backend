-- ============================================================
-- Campus Marketplace — Schema V8: Online Payment & Razorpay Integration
-- Run after schema_v7.sql
-- ============================================================

-- 1. Extend the status check constraint on orders to support online payments
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
    CHECK (status IN (
      'PENDING_MEETUP',        -- Existing offline flow
      'PENDING_PAYMENT',       -- Online flow: order created, awaiting payment
      'PAID_PENDING_MEETUP',   -- Online flow: payment captured, awaiting physical meetup
      'COMPLETED',             -- Both flows: OTP verified and item delivered
      'CANCELLED',             -- Both flows: cancelled before or after payment
      'PENDING',               -- Legacy fallback
      'CONFIRMED'              -- Legacy fallback
    ));

-- Add payment timeout tracking column to orders (15-minute window)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;

-- Ultra-fast partial index: indexes ONLY orders actively waiting for payment (sub-millisecond lookups)
CREATE INDEX IF NOT EXISTS idx_orders_unpaid_expiry
  ON orders (payment_expires_at)
  WHERE status = 'PENDING_PAYMENT';

-- 2. Payment Attempts Table (Tracks buyer payment transactions per order)
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID         NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_paise         BIGINT       NOT NULL CHECK (amount_paise > 0),
  currency             CHAR(3)      NOT NULL DEFAULT 'INR',
  provider             VARCHAR(20)  NOT NULL DEFAULT 'RAZORPAY',
  provider_order_id    VARCHAR(100) NOT NULL,
  provider_payment_id  VARCHAR(100) UNIQUE,
  status               VARCHAR(20)  NOT NULL DEFAULT 'CREATED'
                         CHECK (status IN ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'EXPIRED')),
  failure_reason       TEXT,
  captured_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order_id ON payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_order_id ON payment_attempts(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);

DROP TRIGGER IF EXISTS set_payment_attempts_updated_at ON payment_attempts;
CREATE TRIGGER set_payment_attempts_updated_at
  BEFORE UPDATE ON payment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 3. Payment Events Table (Append-only webhook log & idempotency deduplication guard)
CREATE TABLE IF NOT EXISTS payment_events (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id   VARCHAR(150) NOT NULL UNIQUE,
  event_type          VARCHAR(100) NOT NULL,
  payment_attempt_id  UUID         REFERENCES payment_attempts(id) ON DELETE SET NULL,
  processing_status   VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED'
                        CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  error_message       TEXT,
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_event_id ON payment_events(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_type_time ON payment_events(event_type, received_at);

-- 4. Refunds Table (Tracks refund lifecycle)
CREATE TABLE IF NOT EXISTS refunds (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id  UUID         NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  order_id            UUID         NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_paise        BIGINT       NOT NULL CHECK (amount_paise > 0),
  currency             CHAR(3)      NOT NULL DEFAULT 'INR',
  provider_refund_id  VARCHAR(100) UNIQUE,
  receipt             VARCHAR(100) UNIQUE,
  reason              TEXT,
  status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_attempt_id ON refunds(payment_attempt_id);

DROP TRIGGER IF EXISTS set_refunds_updated_at ON refunds;
CREATE TRIGGER set_refunds_updated_at
  BEFORE UPDATE ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 5. Seller Transfers Table (CONDITIONAL: Used if Razorpay Route marketplace split is activated)
CREATE TABLE IF NOT EXISTS seller_transfers (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID         NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_attempt_id   UUID         NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  seller_id            UUID         NOT NULL REFERENCES users(id),
  linked_account_id    VARCHAR(100) NOT NULL,
  amount_paise         BIGINT       NOT NULL CHECK (amount_paise > 0),
  currency             CHAR(3)      NOT NULL DEFAULT 'INR',
  provider_transfer_id VARCHAR(100) UNIQUE,
  on_hold              BOOLEAN      NOT NULL DEFAULT TRUE,
  status               VARCHAR(20)  NOT NULL DEFAULT 'ON_HOLD'
                         CHECK (status IN ('PENDING', 'ON_HOLD', 'RELEASED', 'SETTLED', 'REVERSED', 'FAILED')),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_transfers_order_id ON seller_transfers(order_id);
CREATE INDEX IF NOT EXISTS idx_seller_transfers_seller_id ON seller_transfers(seller_id);

DROP TRIGGER IF EXISTS set_seller_transfers_updated_at ON seller_transfers;
CREATE TRIGGER set_seller_transfers_updated_at
  BEFORE UPDATE ON seller_transfers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
