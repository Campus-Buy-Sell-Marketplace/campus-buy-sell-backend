// ============================================================
// Campus Marketplace — Product Controller
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';

// ── GET /api/products  (public — no auth needed) ────────────────────────────
export async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, q, limit = '50', offset = '0' } = req.query as Record<string, string>;

    let whereClause = `WHERE p.is_active = TRUE AND (p.stock - p.reserved_stock) > 0`;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (category) {
      whereClause += ` AND p.category = $${paramIndex++}`;
      params.push(category);
    }
    if (q) {
      whereClause += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(
      `SELECT
         p.id, p.title, p.description, p.price, p.category,
         p.condition, p.image_url, p.stock, p.reserved_stock,
         (p.stock - p.reserved_stock) AS available_stock,
         p.created_at,
         u.name AS seller_name, u.id AS seller_id
       FROM products p
       JOIN users u ON p.seller_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p ${whereClause}`,
      params.slice(0, -2)
    );

    res.json({
      products: result.rows,
      total: Number(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('[products.getProducts] error:', err);
    res.status(500).json({ message: 'Failed to fetch products.' });
  }
}

// ── GET /api/products/:id  (public) ─────────────────────────────────────────
export async function getProductById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
         p.id, p.title, p.description, p.price, p.category,
         p.condition, p.image_url, p.stock, p.reserved_stock,
         (p.stock - p.reserved_stock) AS available_stock,
         p.is_active, p.created_at, p.updated_at,
         u.name AS seller_name, u.id AS seller_id
       FROM products p
       JOIN users u ON p.seller_id = u.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Product not found.' });
      return;
    }

    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('[products.getProductById] error:', err);
    res.status(500).json({ message: 'Failed to fetch product.' });
  }
}

// ── POST /api/products  (seller only) ───────────────────────────────────────
export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const sellerId = req.user!.id;
    const { title, description, price, category, condition, image_url, stock } = req.body as {
      title?: string;
      description?: string;
      price?: number;
      category?: string;
      condition?: string;
      image_url?: string;
      stock?: number;
    };

    if (!title?.trim() || price === undefined || price === null) {
      res.status(400).json({ message: 'Title and price are required.' });
      return;
    }
    if (isNaN(Number(price)) || Number(price) < 0) {
      res.status(400).json({ message: 'Price must be a non-negative number.' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO products (seller_id, title, description, price, category, condition, image_url, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        sellerId,
        title.trim(),
        description?.trim() || null,
        Number(price),
        category?.trim() || null,
        condition || 'GOOD',
        image_url?.trim() || null,
        stock !== undefined ? Number(stock) : 1,
      ]
    );

    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    console.error('[products.createProduct] error:', err);
    res.status(500).json({ message: 'Failed to create product.' });
  }
}

// ── PATCH /api/products/:id  (seller only — own products) ───────────────────
export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const sellerId = req.user!.id;
    const { id } = req.params;
    const { title, description, price, category, condition, image_url, stock, is_active } = req.body;

    // Verify ownership
    const own = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND seller_id = $2',
      [id, sellerId]
    );
    if (own.rows.length === 0) {
      res.status(403).json({ message: 'Product not found or you do not own it.' });
      return;
    }

    const result = await pool.query(
      `UPDATE products
       SET title       = COALESCE($1, title),
           description = COALESCE($2, description),
           price       = COALESCE($3, price),
           category    = COALESCE($4, category),
           condition   = COALESCE($5, condition),
           image_url   = COALESCE($6, image_url),
           stock       = COALESCE($7, stock),
           is_active   = COALESCE($8, is_active)
       WHERE id = $9
       RETURNING *`,
      [
        title?.trim() || null,
        description?.trim() || null,
        price !== undefined ? Number(price) : null,
        category?.trim() || null,
        condition || null,
        image_url?.trim() || null,
        stock !== undefined ? Number(stock) : null,
        is_active !== undefined ? Boolean(is_active) : null,
        id,
      ]
    );

    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('[products.updateProduct] error:', err);
    res.status(500).json({ message: 'Failed to update product.' });
  }
}

// ── DELETE /api/products/:id  (seller only — own products) ──────────────────
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  const client = await pool.connect();
  try {
    const sellerId = req.user!.id;
    const { id } = req.params;

    await client.query('BEGIN');

    // Verify ownership
    const check = await client.query(
      'SELECT id FROM products WHERE id = $1 AND seller_id = $2',
      [id, sellerId]
    );

    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(403).json({ message: 'Product not found or you do not own it.' });
      return;
    }

    // Clean up dependent records so FK constraints do not block deletion
    await client.query('DELETE FROM cart_items WHERE product_id = $1', [id]);
    await client.query('DELETE FROM order_items WHERE product_id = $1', [id]);
    await client.query('DELETE FROM products WHERE id = $1 AND seller_id = $2', [id, sellerId]);

    await client.query('COMMIT');
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[products.deleteProduct] error:', err);
    res.status(500).json({ message: 'Failed to delete product.' });
  } finally {
    client.release();
  }
}

// ── GET /api/products/my  (seller's own listings) ───────────────────────────
export async function getMyProducts(req: Request, res: Response): Promise<void> {
  try {
    const sellerId = req.user!.id;
    const result = await pool.query(
      `SELECT id, title, description, price, category, condition, image_url, stock, is_active, created_at, updated_at
       FROM products
       WHERE seller_id = $1
       ORDER BY created_at DESC`,
      [sellerId]
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('[products.getMyProducts] error:', err);
    res.status(500).json({ message: 'Failed to fetch your products.' });
  }
}
