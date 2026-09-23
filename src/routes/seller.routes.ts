import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import pool from '../config/db';

const router = Router();

/**
 * POST /api/seller/apply
 * 
 * Called when a buyer/student applies to become a seller.
 * Updates user role to SELLER in Neon PostgreSQL so they can switch to seller mode.
 */
router.post('/apply', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { businessName, description, contactNumber } = req.body;

    console.log(`[Seller Application] User ${userId} applied:`, { businessName, contactNumber });

    // Upgrade user role to SELLER in Neon database
    await pool.query(
      `UPDATE users SET role = 'SELLER' WHERE id = $1`,
      [userId]
    );

    res.json({ message: 'Seller application approved successfully! Welcome aboard.' });
  } catch (err) {
    console.error('[seller/apply] error:', err);
    res.status(500).json({ message: 'Failed to submit seller application.' });
  }
});

export default router;
