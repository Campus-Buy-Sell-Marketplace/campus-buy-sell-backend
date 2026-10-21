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

/**
 * GET /api/seller/payout-profile
 * Returns the authenticated seller's UPI and bank payout details.
 */
router.get('/payout-profile', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT id, upi_id, account_holder_name, phone_number, bank_name, bank_account_number, bank_ifsc, is_verified, updated_at
       FROM seller_payout_profiles
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ profile: result.rows[0] || null });
  } catch (err) {
    console.error('[seller/payout-profile GET] error:', err);
    res.status(500).json({ message: 'Failed to fetch payout profile.' });
  }
});

/**
 * POST /api/seller/payout-profile
 * Creates or updates the seller's UPI / bank payout details.
 */
router.post('/payout-profile', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const {
      upiId,
      accountHolderName,
      phoneNumber,
      bankName,
      bankAccountNumber,
      bankIfsc,
    } = req.body;

    if (!upiId?.trim() || !accountHolderName?.trim()) {
      res.status(400).json({ message: 'UPI ID and Account Holder Name are required.' });
      return;
    }

    const cleanUpi = upiId.trim().toLowerCase();
    // Basic UPI ID format validation (e.g. name@bank or 10digit@upi)
    if (!cleanUpi.includes('@') || cleanUpi.length < 5) {
      res.status(400).json({ message: 'Please provide a valid UPI ID (e.g., student@okaxis or 9876543210@paytm).' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO seller_payout_profiles (
         user_id, upi_id, account_holder_name, phone_number,
         bank_name, bank_account_number, bank_ifsc, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         upi_id              = EXCLUDED.upi_id,
         account_holder_name = EXCLUDED.account_holder_name,
         phone_number        = EXCLUDED.phone_number,
         bank_name           = EXCLUDED.bank_name,
         bank_account_number = EXCLUDED.bank_account_number,
         bank_ifsc           = EXCLUDED.bank_ifsc,
         updated_at          = NOW()
       RETURNING id, upi_id, account_holder_name, phone_number, bank_name, bank_account_number, bank_ifsc, updated_at`,
      [
        userId,
        cleanUpi,
        accountHolderName.trim(),
        phoneNumber?.trim() || null,
        bankName?.trim() || null,
        bankAccountNumber?.trim() || null,
        bankIfsc?.trim()?.toUpperCase() || null,
      ]
    );

    // Also update any PENDING seller_payouts records that had 'NOT_SET' to this UPI
    await pool.query(
      `UPDATE seller_payouts
       SET seller_upi_id = $1, account_holder_name = $2, updated_at = NOW()
       WHERE seller_id = $3 AND status = 'PENDING' AND (seller_upi_id = 'NOT_SET' OR seller_upi_id = '')`,
      [cleanUpi, accountHolderName.trim(), userId]
    );

    res.json({
      message: 'Payout profile saved successfully!',
      profile: result.rows[0],
    });
  } catch (err) {
    console.error('[seller/payout-profile POST] error:', err);
    res.status(500).json({ message: 'Failed to save payout profile.' });
  }
});

/**
 * GET /api/seller/earnings
 * Returns earnings summary for the seller:
 * - totalSales (gross)
 * - platformFee (2% deducted)
 * - netEarnings (net amount payable/paid)
 * - pendingPayout (waiting for admin transfer)
 * - completedPayout (transferred by admin)
 */
router.get('/earnings', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const statsResult = await pool.query(
      `SELECT
         COALESCE(SUM(order_amount), 0)                                       AS total_gross,
         COALESCE(SUM(commission_amount), 0)                                  AS total_commission,
         COALESCE(SUM(net_payout_amount), 0)                                  AS total_net,
         COALESCE(SUM(net_payout_amount) FILTER (WHERE status = 'PENDING'), 0) AS pending_payout,
         COALESCE(SUM(net_payout_amount) FILTER (WHERE status = 'PAID'), 0)    AS completed_payout,
         COUNT(*) FILTER (WHERE status = 'PENDING')                           AS pending_count,
         COUNT(*) FILTER (WHERE status = 'PAID')                              AS completed_count
       FROM seller_payouts
       WHERE seller_id = $1`,
      [userId]
    );

    const row = statsResult.rows[0];

    res.json({
      totalGross:      Number(row.total_gross),
      totalCommission: Number(row.total_commission),
      totalNet:        Number(row.total_net),
      pendingPayout:   Number(row.pending_payout),
      completedPayout: Number(row.completed_payout),
      pendingCount:    Number(row.pending_count),
      completedCount:  Number(row.completed_count),
      commissionRate:  2.0, // 2%
    });
  } catch (err) {
    console.error('[seller/earnings] error:', err);
    res.status(500).json({ message: 'Failed to fetch earnings.' });
  }
});

/**
 * GET /api/seller/payouts
 * Returns all payout history records for this seller.
 */
router.get('/payouts', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT
         sp.id,
         sp.order_id,
         sp.order_amount,
         sp.commission_percent,
         sp.commission_amount,
         sp.net_payout_amount,
         sp.seller_upi_id,
         sp.status,
         sp.transaction_reference,
         sp.admin_notes,
         sp.paid_at,
         sp.created_at,
         o.created_at AS order_created_at
       FROM seller_payouts sp
       JOIN orders o ON sp.order_id = o.id
       WHERE sp.seller_id = $1
       ORDER BY sp.created_at DESC`,
      [userId]
    );

    res.json({ payouts: result.rows });
  } catch (err) {
    console.error('[seller/payouts] error:', err);
    res.status(500).json({ message: 'Failed to fetch payout records.' });
  }
});

export default router;
