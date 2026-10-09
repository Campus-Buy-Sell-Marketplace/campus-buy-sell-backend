-- ============================================================
-- Campus Marketplace — Schema V7: Order Chat Messages
-- Run after schema_v6.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS order_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_messages_order_id ON order_messages(order_id, created_at);
