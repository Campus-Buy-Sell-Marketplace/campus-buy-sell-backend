// ============================================================
// Campus Marketplace — Order Controller (OTP Edition)
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';
import { purchaseItems } from '../services/purchase.service';

// ── POST /api/orders/checkout ─────────────────────────────────────────────────
// Body: { items?: [{ productId, quantity }], paymentMethod?: 'OFFLINE'|'ONLINE' }
export async function checkout(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
    const paymentMethod: 'OFFLINE' | 'ONLINE' =
      req.body.paymentMethod === 'ONLINE' ? 'ONLINE' : 'OFFLINE';

    let lineItems = req.body.items as Array<{ productId: string; quantity: number }> | undefined;

    // If no items specified, purchase entire cart
    if (!lineItems || lineItems.length === 0) {
      const cartResult = await pool.query(
        `SELECT ci.product_id AS "productId", ci.quantity
         FROM cart_items ci
         WHERE ci.user_id = $1`,
        [buyerId]
      );
      lineItems = cartResult.rows;
    }

    if (!lineItems || lineItems.length === 0) {
      res.status(400).json({ message: 'Your cart is empty.' });
      return;
    }

    const { meetupLocation, meetupTime, meetupNotes } = req.body;
    const order = await purchaseItems(buyerId, lineItems, paymentMethod, {
      location: meetupLocation,
      time: meetupTime,
      notes: meetupNotes,
    });

    res.status(201).json({
      message: 'Order placed successfully!',
      order,
    });
  } catch (err: any) {
    const isLockConflict =
      err?.code === '55P03' ||
      (err?.message || '').includes('could not obtain lock');

    if (isLockConflict) {
      res.status(409).json({
        message: 'Another purchase is in progress for one of these items. Please try again.',
      });
      return;
    }

    const message: string = err?.message || 'Failed to place order.';
    const isClientError =
      message.includes('Insufficient stock') ||
      message.includes('not found') ||
      message.includes('no longer available') ||
      message.includes('Invalid quantity') ||
      message.includes('empty');

    res.status(isClientError ? 400 : 500).json({ message });
  }
}

// ── POST /api/orders/:orderId/verify-otp ─────────────────────────────────────
// Called by the SELLER to confirm delivery using buyer's OTP.
// On success: stock is permanently deducted, order → COMPLETED.
export async function verifyDeliveryOtp(req: Request, res: Response): Promise<void> {
  const client = await pool.connect();
  try {
    const sellerId = req.user!.id;
    const { orderId } = req.params;
    const { otp } = req.body;

    if (!otp || typeof otp !== 'string' || otp.length !== 6) {
      res.status(400).json({ message: 'Please enter a valid 6-digit OTP.' });
      return;
    }

    await client.query('BEGIN');

    // Fetch the order with exclusive row lock — prevents concurrent delivery verification or race with refund
    const orderResult = await client.query(
      `SELECT o.id, o.status, o.delivery_otp, o.otp_verified, o.buyer_id, o.payment_method
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1 AND oi.seller_id = $2
       FOR UPDATE OF o
       LIMIT 1`,
      [orderId, sellerId]
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Order not found or you are not the seller.' });
      return;
    }

    const order = orderResult.rows[0];

    if (order.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      res.status(400).json({ message: 'This order is already completed.' });
      return;
    }

    if (order.status === 'CANCELLED') {
      await client.query('ROLLBACK');
      res.status(400).json({ message: 'This order has been cancelled.' });
      return;
    }

    if (order.status !== 'PENDING_MEETUP' && order.status !== 'PAID_PENDING_MEETUP') {
      await client.query('ROLLBACK');
      res.status(400).json({ message: 'This order is not awaiting delivery.' });
      return;
    }

    // Verify OTP
    if (order.delivery_otp !== otp.trim()) {
      await client.query('ROLLBACK');
      res.status(400).json({ message: 'Incorrect OTP. Please ask the buyer to share the correct code.' });
      return;
    }

    // Fetch all items in this order
    const itemsResult = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    // Permanently deduct stock and free reserved stock for each item
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE products
         SET stock          = stock - $1,
             reserved_stock = GREATEST(reserved_stock - $1, 0),
             is_active      = CASE WHEN (stock - $1) <= 0 THEN FALSE ELSE is_active END
         WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Mark order as COMPLETED
    await client.query(
      `UPDATE orders
       SET status = 'COMPLETED', otp_verified = TRUE, updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    // If order was paid ONLINE, automatically generate a PENDING seller payout record
    if (order.payment_method === 'ONLINE') {
      const sellerItemsRes = await client.query(
        `SELECT SUM(unit_price * quantity) as gross_amount
         FROM order_items
         WHERE order_id = $1 AND seller_id = $2`,
        [orderId, sellerId]
      );

      const grossAmount = Number(sellerItemsRes.rows[0]?.gross_amount || 0);
      if (grossAmount > 0) {
        const commissionPercent = 2.0; // 2% platform fee
        const commissionAmount = Math.round(grossAmount * (commissionPercent / 100) * 100) / 100;
        const netPayoutAmount = Math.max(0, grossAmount - commissionAmount);

        // Fetch seller payout profile if configured
        const profileRes = await client.query(
          `SELECT upi_id, account_holder_name FROM seller_payout_profiles WHERE user_id = $1`,
          [sellerId]
        );

        const upiId = profileRes.rows[0]?.upi_id || 'NOT_SET';
        const accountHolderName = profileRes.rows[0]?.account_holder_name || null;

        await client.query(
          `INSERT INTO seller_payouts (
             order_id, seller_id, order_amount, commission_percent,
             commission_amount, net_payout_amount, seller_upi_id,
             account_holder_name, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
           ON CONFLICT (order_id, seller_id) DO NOTHING`,
          [
            orderId,
            sellerId,
            grossAmount,
            commissionPercent,
            commissionAmount,
            netPayoutAmount,
            upiId,
            accountHolderName,
          ]
        );
      }
    }

    await client.query('COMMIT');

    res.json({ message: 'OTP verified! Order marked as completed. Thank you!' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders.verifyDeliveryOtp] error:', err);
    res.status(500).json({ message: 'Failed to verify OTP. Please try again.' });
  } finally {
    client.release();
  }
}

// ── GET /api/orders — buyer's order history ───────────────────────────────────
export async function getMyOrders(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;

    const result = await pool.query(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
         o.payment_method, o.otp_verified,
         o.meetup_location, o.meetup_time, o.meetup_notes, o.payment_expires_at,
         CASE
           WHEN o.payment_method = 'ONLINE' AND o.status = 'PENDING_PAYMENT' THEN NULL
           ELSE o.delivery_otp
         END AS delivery_otp,
         json_agg(
           json_build_object(
             'product_id', oi.product_id,
             'title',      p.title,
             'quantity',   oi.quantity,
             'unit_price', oi.unit_price,
             'image_url',  p.image_url,
             'seller_name', u.name
           )
           ORDER BY oi.created_at
         ) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN users u ON u.id = oi.seller_id
       WHERE o.buyer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [buyerId]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('[orders.getMyOrders] error:', err);
    res.status(500).json({ message: 'Failed to fetch orders.' });
  }
}

// ── GET /api/orders/:orderId — single order detail (buyer) ────────────────────
export async function getOrderById(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
    const { orderId } = req.params;

    const result = await pool.query(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
         o.payment_method, o.otp_verified,
         o.meetup_location, o.meetup_time, o.meetup_notes, o.payment_expires_at,
         CASE
           WHEN o.payment_method = 'ONLINE' AND o.status = 'PENDING_PAYMENT' THEN NULL
           ELSE o.delivery_otp
         END AS delivery_otp,
         json_agg(
           json_build_object(
             'product_id', oi.product_id,
             'title',      p.title,
             'quantity',   oi.quantity,
             'unit_price', oi.unit_price,
             'image_url',  p.image_url,
             'seller_name', u.name
           )
           ORDER BY oi.created_at
         ) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN users u ON u.id = oi.seller_id
       WHERE o.id = $1 AND o.buyer_id = $2
       GROUP BY o.id`,
      [orderId, buyerId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }

    res.json({ order: result.rows[0] });
  } catch (err) {
    console.error('[orders.getOrderById] error:', err);
    res.status(500).json({ message: 'Failed to fetch order.' });
  }
}

// ── GET /api/orders/seller/incoming — seller's incoming orders ────────────────
export async function getSellerOrders(req: Request, res: Response): Promise<void> {
  try {
    const sellerId = req.user!.id;

    const result = await pool.query(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
         o.payment_method, o.otp_verified,
         o.meetup_location, o.meetup_time, o.meetup_notes,
         bu.name AS buyer_name, bu.email AS buyer_email,
         json_agg(
           json_build_object(
             'product_id', oi.product_id,
             'title',      p.title,
             'quantity',   oi.quantity,
             'unit_price', oi.unit_price,
             'image_url',  p.image_url
           )
           ORDER BY oi.created_at
         ) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND oi.seller_id = $1
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN users bu ON bu.id = o.buyer_id
       GROUP BY o.id, bu.name, bu.email
       ORDER BY o.created_at DESC`,
      [sellerId]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('[orders.getSellerOrders] error:', err);
    res.status(500).json({ message: 'Failed to fetch seller orders.' });
  }
}
