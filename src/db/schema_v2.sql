-- ============================================================
-- Campus Marketplace — Schema V2: Products & Cart
-- Run after schema.sql:
--   psql -U postgres -d campus_marketplace -f src/db/schema_v2.sql
-- ============================================================

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT,
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category      VARCHAR(100),
  condition     VARCHAR(50)   DEFAULT 'GOOD' CHECK (condition IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR')),
  image_url     VARCHAR(500),
  stock         INTEGER       NOT NULL DEFAULT 1 CHECK (stock >= 0),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_seller_id  ON products (seller_id);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_is_active  ON products (is_active);

DROP TRIGGER IF EXISTS set_products_updated_at ON products;
CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ── Cart Items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart_items (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_product_cart UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user_id    ON cart_items (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items (product_id);
