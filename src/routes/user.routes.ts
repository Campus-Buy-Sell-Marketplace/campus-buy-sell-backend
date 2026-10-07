// ============================================================
// Campus Marketplace — User Routes
// Handles: user preferences (settings) + wishlist
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import pool from '../config/db';

const router = Router();

// All user routes require authentication
router.use(authenticate);

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * GET /api/user/preferences
 * Returns the current user's preferences.
 * If no row exists yet, returns the defaults.
 */
router.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT email_notifications FROM user_preferences WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Return defaults — row will be created on first PATCH
      res.json({ email_notifications: true });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[user/preferences GET] error:', err);
    res.status(500).json({ message: 'Failed to fetch preferences.' });
  }
});

/**
 * PATCH /api/user/preferences
 * Upserts the current user's preferences.
 * Body: { email_notifications: boolean }
 */
router.patch('/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { email_notifications } = req.body;

    if (typeof email_notifications !== 'boolean') {
      res.status(400).json({ message: 'email_notifications must be a boolean.' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO user_preferences (user_id, email_notifications, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET email_notifications = EXCLUDED.email_notifications, updated_at = NOW()
       RETURNING email_notifications`,
      [userId, email_notifications]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[user/preferences PATCH] error:', err);
    res.status(500).json({ message: 'Failed to save preferences.' });
  }
});

// ── Wishlist ──────────────────────────────────────────────────────────────────

/**
 * GET /api/user/wishlist
 * Returns all wishlisted products for the current user.
 */
router.get('/wishlist', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT
         w.id AS wishlist_id, w.added_at,
         p.id, p.title, p.description, p.price, p.category,
         p.condition, p.image_url, p.stock, p.is_active,
         u.name AS seller_name, u.id AS seller_id
       FROM wishlist_items w
       JOIN products p ON w.product_id = p.id
       JOIN users u ON p.seller_id = u.id
       WHERE w.user_id = $1
       ORDER BY w.added_at DESC`,
      [userId]
    );

    res.json({ wishlist: result.rows });
  } catch (err) {
    console.error('[user/wishlist GET] error:', err);
    res.status(500).json({ message: 'Failed to fetch wishlist.' });
  }
});

/**
 * GET /api/user/wishlist/ids
 * Returns just the product IDs in the user's wishlist (for fast UI checks).
 */
router.get('/wishlist/ids', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT product_id FROM wishlist_items WHERE user_id = $1`,
      [userId]
    );
    res.json({ ids: result.rows.map((r) => r.product_id) });
  } catch (err) {
    console.error('[user/wishlist/ids GET] error:', err);
    res.status(500).json({ message: 'Failed to fetch wishlist ids.' });
  }
});

/**
 * POST /api/user/wishlist
 * Add a product to the wishlist.
 * Body: { product_id: string }
 */
router.post('/wishlist', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { product_id } = req.body;

    if (!product_id) {
      res.status(400).json({ message: 'product_id is required.' });
      return;
    }

    await pool.query(
      `INSERT INTO wishlist_items (user_id, product_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO NOTHING`,
      [userId, product_id]
    );

    res.json({ message: 'Added to wishlist.' });
  } catch (err) {
    console.error('[user/wishlist POST] error:', err);
    res.status(500).json({ message: 'Failed to add to wishlist.' });
  }
});

/**
 * DELETE /api/user/wishlist/:productId
 * Remove a product from the wishlist.
 */
router.delete('/wishlist/:productId', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { productId } = req.params;

    await pool.query(
      `DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2`,
      [userId, productId]
    );

    res.json({ message: 'Removed from wishlist.' });
  } catch (err) {
    console.error('[user/wishlist DELETE] error:', err);
    res.status(500).json({ message: 'Failed to remove from wishlist.' });
  }
});

export default router;
