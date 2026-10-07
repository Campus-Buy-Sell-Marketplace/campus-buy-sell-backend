-- ============================================================
-- Campus Marketplace — Schema V4: User Preferences & Wishlist
-- Run after schema_v3.sql
-- ============================================================

-- ── User Preferences ─────────────────────────────────────────────────────────
-- Stores per-user settings (e.g., notification toggle)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id           UUID    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Wishlist ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishlist_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_product_wishlist UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_user_id    ON wishlist_items (user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_product_id ON wishlist_items (product_id);
