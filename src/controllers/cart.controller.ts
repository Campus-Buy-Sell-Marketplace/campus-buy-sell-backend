// ============================================================
// Campus Marketplace — Cart Controller
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';

// ── GET /api/cart  — get current user's cart ─────────────────────────────────
export async function getCart(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT
         ci.id AS cart_item_id,
         ci.quantity,
         ci.added_at,
         p.id AS product_id,
         p.title,
         p.price,
         p.image_url,
         p.stock,
         p.is_active,
         u.name AS seller_name
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       JOIN users u ON p.seller_id = u.id
       WHERE ci.user_id = $1
       ORDER BY ci.added_at DESC`,
      [userId]
    );

    res.json({ items: result.rows });
  } catch (err) {
    console.error('[cart.getCart] error:', err);
    res.status(500).json({ message: 'Failed to fetch cart.' });
  }
}

// ── POST /api/cart  — add or increment item (stock-capped) ───────────────────
export async function addToCart(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { productId, quantity = 1 } = req.body as { productId?: string; quantity?: number };

    if (!productId) {
      res.status(400).json({ message: 'productId is required.' });
      return;
    }

    const qty = Math.max(1, Number(quantity));

    // Verify product exists and is active; get current stock
    const productCheck = await pool.query(
      'SELECT id, stock FROM products WHERE id = $1 AND is_active = TRUE',
      [productId]
    );
    if (productCheck.rows.length === 0) {
      res.status(404).json({ message: 'Product not found or unavailable.' });
      return;
    }

    const availableStock: number = productCheck.rows[0].stock;

    if (availableStock === 0) {
      res.status(409).json({ message: 'This product is out of stock.' });
      return;
    }

    // Calculate what the new quantity would be (existing + requested)
    const existing = await pool.query(
      'SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    );
    const existingQty: number = existing.rows[0]?.quantity ?? 0;
    const desiredQty = existingQty + qty;

    // Cap at available stock — never let cart quantity exceed stock
    const finalQty = Math.min(desiredQty, availableStock);

    if (finalQty <= existingQty) {
      // Already at maximum stock, nothing to add
      res.status(409).json({
        message: `You already have the maximum available quantity (${availableStock}) in your cart.`,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = $3
       RETURNING *`,
      [userId, productId, finalQty]
    );

    res.json({ item: result.rows[0], message: 'Added to cart.' });
  } catch (err) {
    console.error('[cart.addToCart] error:', err);
    res.status(500).json({ message: 'Failed to add to cart.' });
  }
}


// ── PATCH /api/cart/:itemId  — update quantity (stock-capped) ────────────────
export async function updateCartItem(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { itemId } = req.params;
    const { quantity } = req.body as { quantity?: number };

    if (!quantity || Number(quantity) < 1) {
      res.status(400).json({ message: 'Quantity must be at least 1.' });
      return;
    }

    // Fetch the cart item to find the product
    const cartItemCheck = await pool.query(
      `SELECT ci.product_id, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.id = $1 AND ci.user_id = $2`,
      [itemId, userId]
    );
    if (cartItemCheck.rows.length === 0) {
      res.status(404).json({ message: 'Cart item not found.' });
      return;
    }

    const availableStock: number = cartItemCheck.rows[0].stock;
    const cappedQty = Math.min(Number(quantity), availableStock);

    if (cappedQty < Number(quantity)) {
      // Silently cap, but tell the client
    }

    const result = await pool.query(
      `UPDATE cart_items SET quantity = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [cappedQty, itemId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Cart item not found.' });
      return;
    }

    res.json({
      item: result.rows[0],
      ...(cappedQty < Number(quantity)
        ? { warning: `Quantity capped at available stock (${availableStock}).` }
        : {}),
    });

  } catch (err) {
    console.error('[cart.updateCartItem] error:', err);
    res.status(500).json({ message: 'Failed to update cart item.' });
  }
}

// ── DELETE /api/cart/:itemId  — remove item ──────────────────────────────────
export async function removeFromCart(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { itemId } = req.params;

    const result = await pool.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING id',
      [itemId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Cart item not found.' });
      return;
    }

    res.json({ message: 'Item removed from cart.' });
  } catch (err) {
    console.error('[cart.removeFromCart] error:', err);
    res.status(500).json({ message: 'Failed to remove from cart.' });
  }
}

// ── DELETE /api/cart  — clear entire cart ────────────────────────────────────
export async function clearCart(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    await pool.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
    res.json({ message: 'Cart cleared.' });
  } catch (err) {
    console.error('[cart.clearCart] error:', err);
    res.status(500).json({ message: 'Failed to clear cart.' });
  }
}
