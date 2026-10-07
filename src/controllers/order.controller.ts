// ============================================================
// Campus Marketplace — Order Controller
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';
import { purchaseItems } from '../services/purchase.service';

// ── POST /api/orders/checkout  — purchase cart or specified items ─────────────
// Body: { items?: [{ productId, quantity }] }   (omit to buy entire cart)
export async function checkout(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
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

    const order = await purchaseItems(buyerId, lineItems);

    res.status(201).json({
      message: 'Order placed successfully!',
      order,
    });
  } catch (err: any) {
    // NOWAIT lock contention: another transaction holds the row lock
    const isLockConflict =
      err?.code === '55P03' ||
      (err?.message || '').includes('could not obtain lock');

    if (isLockConflict) {
      res.status(409).json({
        message: 'Another purchase is in progress for one of these items. Please try again in a moment.',
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

// ── GET /api/orders  — current user's order history ─────────────────────────
export async function getMyOrders(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;

    const ordersResult = await pool.query(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
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
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.buyer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [buyerId]
    );

    res.json({ orders: ordersResult.rows });
  } catch (err) {
    console.error('[orders.getMyOrders] error:', err);
    res.status(500).json({ message: 'Failed to fetch orders.' });
  }
}

// ── GET /api/orders/:orderId  — single order detail ──────────────────────────
export async function getOrderById(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
    const { orderId } = req.params;

    const result = await pool.query(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
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
