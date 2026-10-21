import { Request, Response } from 'express';
import pool from '../config/db';

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
// Returns platform-wide counts for the admin dashboard.
export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const userResult = await pool.query(`
      SELECT
        COUNT(*)                                 AS total_users,
        COUNT(*) FILTER (WHERE role = 'SELLER')  AS total_sellers,
        COUNT(*) FILTER (WHERE role = 'STUDENT') AS total_students,
        COUNT(*) FILTER (WHERE role = 'ADMIN')   AS total_admins
      FROM users
    `);

    const appResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING') AS pending_applications
      FROM seller_applications
    `);

    const payoutResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING')                                     AS pending_payouts_count,
        COALESCE(SUM(net_payout_amount) FILTER (WHERE status = 'PENDING'), 0)          AS pending_payouts_amount,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'PAID'), 0)             AS platform_commission_earned
      FROM seller_payouts
    `);

    const escrowResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PAID_PENDING_MEETUP')                        AS escrow_orders_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'PAID_PENDING_MEETUP'), 0)  AS escrow_orders_amount
      FROM orders
    `);

    const userRow = userResult.rows[0];
    const appRow = appResult.rows[0];
    const payoutRow = payoutResult.rows[0];
    const escrowRow = escrowResult.rows[0];

    res.json({
      totalUsers:               Number(userRow.total_users),
      totalSellers:             Number(userRow.total_sellers),
      totalStudents:            Number(userRow.total_students),
      totalAdmins:              Number(userRow.total_admins),
      pendingApplications:      Number(appRow?.pending_applications || 0),
      pendingPayoutsCount:      Number(payoutRow?.pending_payouts_count || 0),
      pendingPayoutsAmount:     Number(payoutRow?.pending_payouts_amount || 0),
      platformCommissionEarned: Number(payoutRow?.platform_commission_earned || 0),
      escrowOrdersCount:        Number(escrowRow?.escrow_orders_count || 0),
      escrowOrdersAmount:       Number(escrowRow?.escrow_orders_amount || 0),
    });
  } catch (err) {
    console.error('[admin.getStats] error:', err);
    res.status(500).json({ message: 'Failed to fetch stats.' });
  }
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Returns a list of all users (without passwords).
export async function getUsers(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role, avatar_url, created_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json({ users: result.rows });
  } catch (err) {
    console.error('[admin.getUsers] error:', err);
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
}

// ── PATCH /api/admin/users/:id/role ──────────────────────────────────────────
// Allows admin to change a user's role (e.g. promote STUDENT → SELLER).
export async function updateUserRole(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { role } = req.body as { role?: string };

  const allowed = ['STUDENT', 'SELLER', 'ADMIN'];
  if (!role || !allowed.includes(role)) {
    res.status(400).json({ message: 'Invalid role. Allowed: STUDENT, SELLER, ADMIN.' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, name, email, role, created_at`,
      [role, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[admin.updateUserRole] error:', err);
    res.status(500).json({ message: 'Failed to update user role.' });
  }
}

// ── GET /api/admin/seller-applications ───────────────────────────────────────
// Returns all seller applications joined with applicant user data.
export async function getSellerApplications(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT 
        sa.id,
        sa.user_id,
        sa.business_name,
        sa.description,
        sa.contact_number,
        sa.status,
        sa.admin_notes,
        sa.created_at,
        sa.updated_at,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM seller_applications sa
      JOIN users u ON sa.user_id = u.id
      ORDER BY 
        CASE WHEN sa.status = 'PENDING' THEN 1 ELSE 2 END,
        sa.created_at DESC
    `);

    res.json({ applications: result.rows });
  } catch (err) {
    console.error('[admin.getSellerApplications] error:', err);
    res.status(500).json({ message: 'Failed to fetch seller applications.' });
  }
}

// ── PATCH /api/admin/seller-applications/:id/status ──────────────────────────
// Admin approves or rejects a seller application.
export async function updateSellerApplicationStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };

  if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
    res.status(400).json({ message: 'Invalid status. Must be APPROVED or REJECTED.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appResult = await client.query(
      `UPDATE seller_applications
       SET status = $1, admin_notes = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, adminNotes || null, id]
    );

    if (appResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Seller application not found.' });
      return;
    }

    const application = appResult.rows[0];

    // If APPROVED, promote the student to SELLER
    if (status === 'APPROVED') {
      await client.query(
        `UPDATE users SET role = 'SELLER' WHERE id = $1`,
        [application.user_id]
      );
    } else if (status === 'REJECTED') {
      // If REJECTED and they were marked as SELLER, revert to STUDENT
      await client.query(
        `UPDATE users SET role = 'STUDENT' WHERE id = $1 AND role = 'SELLER'`,
        [application.user_id]
      );
    }

    await client.query('COMMIT');

    // Fetch the updated combined record to return to caller
    const fullResult = await pool.query(
      `SELECT 
         sa.id, sa.user_id, sa.business_name, sa.description, sa.contact_number, 
         sa.status, sa.admin_notes, sa.created_at, sa.updated_at,
         u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM seller_applications sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.id = $1`,
      [id]
    );

    res.json({
      message: `Application ${status.toLowerCase()} successfully.`,
      application: fullResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin.updateSellerApplicationStatus] error:', err);
    res.status(500).json({ message: 'Failed to update application status.' });
  } finally {
    client.release();
  }
}

// ── GET /api/admin/payouts ───────────────────────────────────────────────────
// Returns all seller payouts, optionally filtered by status (?status=PENDING)
export async function getPayouts(req: Request, res: Response): Promise<void> {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        sp.id,
        sp.order_id,
        sp.seller_id,
        sp.order_amount,
        sp.commission_percent,
        sp.commission_amount,
        sp.net_payout_amount,
        sp.seller_upi_id,
        sp.account_holder_name,
        sp.status,
        sp.transaction_reference,
        sp.admin_notes,
        sp.paid_at,
        sp.created_at,
        u.name AS seller_name,
        u.email AS seller_email,
        spp.phone_number AS seller_phone,
        o.payment_method,
        o.created_at AS order_created_at
      FROM seller_payouts sp
      JOIN users u ON sp.seller_id = u.id
      JOIN orders o ON sp.order_id = o.id
      LEFT JOIN seller_payout_profiles spp ON spp.user_id = sp.seller_id
    `;

    const values: any[] = [];
    if (status && typeof status === 'string' && status !== 'ALL') {
      query += ` WHERE sp.status = $1`;
      values.push(status.toUpperCase());
    }

    query += ` ORDER BY sp.created_at DESC`;

    const result = await pool.query(query, values);
    res.json({ payouts: result.rows });
  } catch (err) {
    console.error('[admin.getPayouts] error:', err);
    res.status(500).json({ message: 'Failed to fetch payouts.' });
  }
}

// ── PATCH /api/admin/payouts/:id/mark-paid ──────────────────────────────────
// Allows admin to record that manual UPI / bank transfer was completed.
export async function markPayoutAsPaid(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { transactionReference, adminNotes } = req.body;

    if (!transactionReference?.trim()) {
      res.status(400).json({ message: 'Transaction reference / UTR is required.' });
      return;
    }

    const checkResult = await pool.query(
      `SELECT id, status FROM seller_payouts WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      res.status(404).json({ message: 'Payout record not found.' });
      return;
    }

    const updateResult = await pool.query(
      `UPDATE seller_payouts
       SET status = 'PAID',
           transaction_reference = $1,
           admin_notes = $2,
           paid_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [transactionReference.trim(), adminNotes?.trim() || null, id]
    );

    res.json({
      message: 'Payout marked as PAID successfully!',
      payout: updateResult.rows[0],
    });
  } catch (err) {
    console.error('[admin.markPayoutAsPaid] error:', err);
    res.status(500).json({ message: 'Failed to mark payout as paid.' });
  }
}

// ── GET /api/admin/escrow-orders ─────────────────────────────────────────────
// Returns orders where buyer paid online, currently held in escrow awaiting delivery
export async function getEscrowOrders(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        o.id,
        o.buyer_id,
        o.total_amount,
        o.payment_method,
        o.status,
        o.delivery_otp,
        o.meetup_location,
        o.meetup_time,
        o.created_at,
        b.name AS buyer_name,
        b.email AS buyer_email,
        s.name AS seller_name,
        s.email AS seller_email,
        s.id AS seller_id,
        p.title AS product_title,
        oi.quantity,
        oi.unit_price
      FROM orders o
      JOIN users b ON b.id = o.buyer_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN users s ON s.id = oi.seller_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'PAID_PENDING_MEETUP'
      ORDER BY o.created_at DESC
    `);

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('[admin.getEscrowOrders] error:', err);
    res.status(500).json({ message: 'Failed to fetch escrow orders.' });
  }
}

// ── POST /api/admin/orders/:orderId/confirm-delivery ─────────────────────────
// Admin override to verify delivery & move order from ESCROW -> COMPLETED -> PENDING PAYOUT
export async function confirmDeliveryAsAdmin(req: Request, res: Response): Promise<void> {
  const client = await pool.connect();
  try {
    const { orderId } = req.params;

    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT id, status, payment_method FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Order not found.' });
      return;
    }

    const order = orderRes.rows[0];
    if (order.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      res.status(400).json({ message: 'Order is already completed.' });
      return;
    }

    // Permanently deduct stock
    const itemsRes = await client.query(
      `SELECT product_id, quantity, seller_id, unit_price FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE products
         SET stock          = stock - $1,
             reserved_stock = GREATEST(reserved_stock - $1, 0),
             is_active      = CASE WHEN (stock - $1) <= 0 THEN FALSE ELSE is_active END
         WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Update order status to COMPLETED
    await client.query(
      `UPDATE orders SET status = 'COMPLETED', otp_verified = TRUE, updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    // If order was paid ONLINE, generate PENDING seller payout
    if (order.payment_method === 'ONLINE') {
      const sellerTotalsRes = await client.query(
        `SELECT seller_id, SUM(unit_price * quantity) as gross_amount
         FROM order_items
         WHERE order_id = $1
         GROUP BY seller_id`,
        [orderId]
      );

      for (const row of sellerTotalsRes.rows) {
        const gross = Number(row.gross_amount);
        const feeRate = 2.0;
        const feeAmount = Math.round(gross * (feeRate / 100) * 100) / 100;
        const netPayout = Math.max(0, gross - feeAmount);

        const profRes = await client.query(
          `SELECT upi_id, account_holder_name FROM seller_payout_profiles WHERE user_id = $1`,
          [row.seller_id]
        );

        const upiId = profRes.rows[0]?.upi_id || 'NOT_SET';
        const holderName = profRes.rows[0]?.account_holder_name || null;

        await client.query(
          `INSERT INTO seller_payouts (
             order_id, seller_id, order_amount, commission_percent,
             commission_amount, net_payout_amount, seller_upi_id,
             account_holder_name, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
           ON CONFLICT (order_id, seller_id) DO NOTHING`,
          [orderId, row.seller_id, gross, feeRate, feeAmount, netPayout, upiId, holderName]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Delivery confirmed successfully! Order marked as completed and queued for payout.' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[admin.confirmDeliveryAsAdmin] error:', err);
    res.status(500).json({ message: 'Failed to confirm delivery.' });
  } finally {
    client.release();
  }
}
