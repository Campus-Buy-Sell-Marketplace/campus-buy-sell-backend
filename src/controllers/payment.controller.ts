// ============================================================
// Campus Marketplace — Payment Controller
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';
import {
  initiatePayment,
  verifyPayment as verifyPaymentService,
  processWebhookEvent,
  initiateRefund as initiateRefundService,
} from '../services/payment.service';

/**
 * POST /api/payments/init
 * Body: { orderId: string }
 */
export async function initPayment(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
    const { orderId } = req.body;

    if (!orderId) {
      res.status(400).json({ message: 'Missing orderId in request body.' });
      return;
    }

    const result = await initiatePayment(orderId, buyerId);
    res.json(result);
  } catch (err: any) {
    console.error('[payment.initPayment] error:', err.message || err);
    const message = err.message || 'Failed to initiate payment.';
    const isClientError =
      message.includes('not found') ||
      message.includes('Unauthorized') ||
      message.includes('offline') ||
      message.includes('expired') ||
      message.includes('already been paid');

    res.status(isClientError ? 400 : 500).json({ message });
  }
}

/**
 * POST /api/payments/verify
 * Body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const buyerId = req.user!.id;
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      res.status(400).json({
        message: 'Missing required payment verification fields (orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature).',
      });
      return;
    }

    const result = await verifyPaymentService(
      orderId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      buyerId
    );

    res.json(result);
  } catch (err: any) {
    console.error('[payment.verifyPayment] error:', err.message || err);
    res.status(400).json({ message: err.message || 'Payment verification failed.' });
  }
}

/**
 * POST /api/payments/webhook
 * Public endpoint for Razorpay server-to-server webhook callbacks.
 * Body is a raw Buffer (via express.raw({ type: 'application/json' })).
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!signature) {
    res.status(400).json({ message: 'Missing x-razorpay-signature header.' });
    return;
  }

  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  try {
    await processWebhookEvent(rawBuffer, signature);
    res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('[payment.handleWebhook] error:', err.message || err);
    if (err.message && err.message.includes('Invalid webhook signature')) {
      res.status(400).json({ message: 'Invalid webhook signature.' });
    } else {
      // Return 200 to Razorpay for handled internal errors to prevent infinite webhook retries if malformed
      res.status(200).json({ status: 'error_logged', message: err.message });
    }
  }
}

/**
 * POST /api/payments/:orderId/refund
 * Body: { reason?: string }
 */
export async function refundPayment(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const { orderId } = req.params;
    const { reason } = req.body;

    const result = await initiateRefundService(orderId, userId, userRole, reason);
    res.json(result);
  } catch (err: any) {
    console.error('[payment.refundPayment] error:', err.message || err);
    res.status(400).json({ message: err.message || 'Refund initiation failed.' });
  }
}

/**
 * GET /api/payments/orders/:orderId/status
 */
export async function getPaymentStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;

    const orderResult = await pool.query(
      `SELECT id, buyer_id, status, total_amount, payment_method, payment_expires_at
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }

    const order = orderResult.rows[0];

    // Check authorization: buyer or seller in order
    if (order.buyer_id !== userId && req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      const sellerCheck = await pool.query(
        `SELECT 1 FROM order_items WHERE order_id = $1 AND seller_id = $2 LIMIT 1`,
        [orderId, userId]
      );
      if (sellerCheck.rows.length === 0) {
        res.status(403).json({ message: 'Unauthorized to view payment status for this order.' });
        return;
      }
    }

    // Latest payment attempt
    const attemptsResult = await pool.query(
      `SELECT id, provider_order_id, provider_payment_id, status, amount_paise, created_at, captured_at, failure_reason
       FROM payment_attempts
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    );

    // Latest refund
    const refundResult = await pool.query(
      `SELECT id, provider_refund_id, amount_paise, status, reason, created_at
       FROM refunds
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    );

    res.json({
      orderId: order.id,
      orderStatus: order.status,
      paymentMethod: order.payment_method,
      paymentExpiresAt: order.payment_expires_at,
      latestAttempt: attemptsResult.rows[0] || null,
      latestRefund: refundResult.rows[0] || null,
    });
  } catch (err: any) {
    console.error('[payment.getPaymentStatus] error:', err.message || err);
    res.status(500).json({ message: 'Failed to retrieve payment status.' });
  }
}
