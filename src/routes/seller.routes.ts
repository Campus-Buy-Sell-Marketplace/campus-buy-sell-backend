import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import pool from '../config/db';

const router = Router();

/**
 * POST /api/seller/apply
 * 
 * Called when a buyer/student applies to become a seller.
 * Saves application details into seller_applications with status 'PENDING'.
 * Admin reviews and verifies before granting the SELLER role.
 */
router.post('/apply', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { businessName, description, contactNumber } = req.body;

    if (!businessName?.trim() || !description?.trim() || !contactNumber?.trim()) {
      res.status(400).json({ message: 'All fields (Shop name, description, and contact number) are required.' });
      return;
    }

    console.log(`[Seller Application] User ${userId} submitted application:`, { businessName, contactNumber });

    // Insert or update seller application with PENDING status
    const result = await pool.query(
      `INSERT INTO seller_applications (user_id, business_name, description, contact_number, status, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         business_name  = EXCLUDED.business_name,
         description    = EXCLUDED.description,
         contact_number = EXCLUDED.contact_number,
         status         = 'PENDING',
         admin_notes    = NULL,
         updated_at     = NOW()
       RETURNING id, user_id, business_name, description, contact_number, status, created_at, updated_at`,
      [userId, businessName.trim(), description.trim(), contactNumber.trim()]
    );

    res.json({
      message: 'Seller application submitted successfully! It is now pending admin review.',
      application: result.rows[0],
    });
  } catch (err) {
    console.error('[seller/apply] error:', err);
    res.status(500).json({ message: 'Failed to submit seller application.' });
  }
});

/**
 * GET /api/seller/application-status
 * 
 * Returns the current user's seller application status (if any).
 */
router.get('/application-status', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT id, business_name, description, contact_number, status, admin_notes, created_at, updated_at
       FROM seller_applications
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({ hasApplied: false, application: null });
      return;
    }

    res.json({
      hasApplied: true,
      application: result.rows[0],
    });
  } catch (err) {
    console.error('[seller/application-status] error:', err);
    res.status(500).json({ message: 'Failed to fetch application status.' });
  }
});

export default router;
