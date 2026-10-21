// ============================================================
// Campus Marketplace — Payment Service (Razorpay Integration)
// ============================================================

import crypto from 'crypto';
import pool from '../config/db';
import { razorpayClient, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from '../config/razorpay';
import { rupeesToPaise } from '../utils/currency';

export interface InitiatePaymentResult {
  orderId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
}

export interface VerifyPaymentResult {
  status: 'PAID';
  orderId: string;
  deliveryOtp: string;
  message: string;
}

/**
 * 1. Initiate Online Payment
 * Creates an authoritative Razorpay order session for a PENDING_PAYMENT order.
 * Follows strict isolation: external provider call happens OUTSIDE database transactions.
 */
export async function initiatePayment(orderId: string, buyerId: string): Promise<InitiatePaymentResult> {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay API keys are not configured. Please add your Live Key ID and Secret to .env');
  }

  // A. Fetch and validate order
  const orderResult = await pool.query(
    `SELECT id, buyer_id, status, payment_method, payment_expires_at
     FROM orders
     WHERE id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    throw new Error('Order not found.');
  }

  const order = orderResult.rows[0];

  if (order.buyer_id !== buyerId) {
    throw new Error('Unauthorized: You are not the buyer for this order.');
  }

  if (order.payment_method !== 'ONLINE') {
    throw new Error('This order was configured for Pay at Meetup (offline).');
  }

  if (order.status !== 'PENDING_PAYMENT') {
    if (order.status === 'PAID_PENDING_MEETUP' || order.status === 'COMPLETED') {
      throw new Error('This order has already been paid.');
    }
    throw new Error(`Order cannot be paid in current status: ${order.status}`);
  }

  if (order.payment_expires_at && new Date(order.payment_expires_at).getTime() < Date.now()) {
    throw new Error('Payment window for this order has expired. Please create a new order.');
  }

  // B. Check for existing active attempt (Idempotency: reuse unexpired attempt)
  const existingAttemptResult = await pool.query(
    `SELECT id, provider_order_id, amount_paise, currency, status, created_at
     FROM payment_attempts
     WHERE order_id = $1 AND status IN ('CREATED', 'PENDING')
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId]
  );

  if (existingAttemptResult.rows.length > 0) {
    const existing = existingAttemptResult.rows[0];
    const ageMinutes = (Date.now() - new Date(existing.created_at).getTime()) / (1000 * 60);
    if (ageMinutes < 14) {
      return {
        orderId,
        razorpayOrderId: existing.provider_order_id,
        amountPaise: Number(existing.amount_paise),
        currency: existing.currency,
        keyId: RAZORPAY_KEY_ID,
      };
    }
  }

  // C. Calculate authoritative order total in paise from database items
  const itemsResult = await pool.query(
    `SELECT unit_price, quantity FROM order_items WHERE order_id = $1`,
    [orderId]
  );

  if (itemsResult.rows.length === 0) {
    throw new Error('Order has no items.');
  }

  let totalPaise = 0n;
  for (const item of itemsResult.rows) {
    const itemPaise = rupeesToPaise(item.unit_price) * BigInt(item.quantity);
    totalPaise += itemPaise;
  }

  const amountPaiseNumber = Number(totalPaise);

  // D. Call Razorpay Orders API outside of any DB transaction
  const shortReceipt = `rcpt_${orderId.replace(/-/g, '').slice(0, 30)}`;
  const rzpOrder = await razorpayClient.orders.create({
    amount: amountPaiseNumber,
    currency: 'INR',
    receipt: shortReceipt,
    notes: {
      orderId,
      buyerId,
    },
  });

  // E. Record payment attempt in DB
  await pool.query(
    `INSERT INTO payment_attempts (order_id, amount_paise, currency, provider, provider_order_id, status)
     VALUES ($1, $2, 'INR', 'RAZORPAY', $3, 'CREATED')`,
    [orderId, amountPaiseNumber, rzpOrder.id]
  );

  return {
    orderId,
    razorpayOrderId: rzpOrder.id,
    amountPaise: amountPaiseNumber,
    currency: 'INR',
    keyId: RAZORPAY_KEY_ID,
  };
}

/**
 * 2. Verify Online Payment (Synchronous Checkout Handler)
 * Performs constant-time HMAC check, calls Razorpay payments API, and updates DB atomically.
 */
export async function verifyPayment(
  orderId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  buyerId: string
): Promise<VerifyPaymentResult> {
  // A. Verify constant-time HMAC signature
  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(payload)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const receivedBuf = Buffer.from(razorpaySignature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid payment signature. Verification failed.');
  }

  // B. Fetch order and verify ownership
  const orderResult = await pool.query(
    `SELECT id, buyer_id, status, delivery_otp FROM orders WHERE id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    throw new Error('Order not found.');
  }

  const order = orderResult.rows[0];
  if (order.buyer_id !== buyerId) {
    throw new Error('Unauthorized order access.');
  }

  // Idempotency check: if already paid (e.g. by async webhook arriving first), return success
  if (order.status === 'PAID_PENDING_MEETUP' || order.status === 'COMPLETED') {
    return {
      status: 'PAID',
      orderId,
      deliveryOtp: order.delivery_otp,
      message: 'Payment verified successfully.',
    };
  }

  // Late payment protocol: Order was cancelled (e.g. 15-minute window expired while paying)
  if (order.status === 'CANCELLED') {
    const rzpPayment = await razorpayClient.payments.fetch(razorpayPaymentId);
    if (rzpPayment.status === 'captured') {
      const refundReceipt = `ref_late_${order.id.replace(/-/g, '').slice(0, 20)}`;
      await razorpayClient.payments.refund(razorpayPaymentId, {
        amount: Number(rzpPayment.amount),
        speed: 'normal',
        receipt: refundReceipt,
        notes: {
          orderId,
          reason: 'Order expired prior to payment confirmation',
        },
      });

      await pool.query(
        `INSERT INTO refunds (payment_attempt_id, order_id, amount_paise, provider_refund_id, receipt, reason, status)
         SELECT id, order_id, amount_paise, $1, $2, 'Order expired prior to payment confirmation', 'PROCESSED'
         FROM payment_attempts WHERE order_id = $3 AND provider_order_id = $4
         ON CONFLICT (provider_refund_id) DO NOTHING`,
        [`rfnd_late_${Date.now()}`, refundReceipt, orderId, razorpayOrderId]
      );
    }
    throw new Error('This order expired before payment was confirmed. A full refund has been automatically initiated to your bank account.');
  }

  // C. Find payment attempt
  const attemptResult = await pool.query(
    `SELECT id, amount_paise, status FROM payment_attempts
     WHERE order_id = $1 AND provider_order_id = $2`,
    [orderId, razorpayOrderId]
  );

  if (attemptResult.rows.length === 0) {
    throw new Error('Payment attempt record not found for this order.');
  }

  const attempt = attemptResult.rows[0];

  // D. Query Razorpay API to confirm payment status is captured
  const rzpPayment = await razorpayClient.payments.fetch(razorpayPaymentId);
  if (rzpPayment.status !== 'captured') {
    throw new Error(`Payment is not in captured status (current: ${rzpPayment.status}).`);
  }

  if (rzpPayment.order_id !== razorpayOrderId) {
    throw new Error('Payment order ID does not match expected Razorpay order ID.');
  }

  if (Number(rzpPayment.amount) !== Number(attempt.amount_paise)) {
    throw new Error('Payment amount mismatch.');
  }

  // E. Atomic Database Transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock order row to synchronize with any concurrent webhook or refund
    const lockedOrderResult = await client.query(
      `SELECT status, delivery_otp FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (lockedOrderResult.rows.length === 0) {
      throw new Error('Order not found during verification.');
    }

    const currentStatus = lockedOrderResult.rows[0].status;
    if (currentStatus === 'CANCELLED') {
      await client.query('ROLLBACK');
      throw new Error('Order expired before payment was confirmed. Please refresh your orders page.');
    }

    // Update payment attempt to CAPTURED
    await client.query(
      `UPDATE payment_attempts
       SET status = 'CAPTURED',
           provider_payment_id = $1,
           captured_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [razorpayPaymentId, attempt.id]
    );

    // Update order status to PAID_PENDING_MEETUP if still PENDING_PAYMENT
    if (currentStatus === 'PENDING_PAYMENT') {
      await client.query(
        `UPDATE orders
         SET status = 'PAID_PENDING_MEETUP',
             updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    status: 'PAID',
    orderId,
    deliveryOtp: order.delivery_otp,
    message: 'Payment verified successfully. Please present your delivery OTP during item collection.',
  };
}

/**
 * 3. Handle Webhook Events
 * Intercepts raw buffer, verifies signature, deduplicates via payment_events,
 * and updates state machines or executes late-payment refunds.
 */
export async function processWebhookEvent(rawBodyBuffer: Buffer, receivedSignature: string): Promise<void> {
  // A. Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBodyBuffer)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const receivedBuf = Buffer.from(receivedSignature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid webhook signature.');
  }

  // B. Parse JSON payload
  const event = JSON.parse(rawBodyBuffer.toString('utf8'));
  const eventId: string = event.event_id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const eventType: string = event.event;

  // C. Deduplication check via payment_events table
  const insertEventResult = await pool.query(
    `INSERT INTO payment_events (provider_event_id, event_type, processing_status)
     VALUES ($1, $2, 'RECEIVED')
     ON CONFLICT (provider_event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType]
  );

  if (insertEventResult.rows.length === 0) {
    // Already processed this webhook event
    return;
  }
  const dbEventId = insertEventResult.rows[0].id;

  try {
    if (eventType === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment && payment.order_id) {
        const attemptResult = await pool.query(
          `SELECT id, order_id, status FROM payment_attempts WHERE provider_order_id = $1`,
          [payment.order_id]
        );

        if (attemptResult.rows.length > 0) {
          const attempt = attemptResult.rows[0];
          const orderResult = await pool.query(
            `SELECT id, status FROM orders WHERE id = $1`,
            [attempt.order_id]
          );

          if (orderResult.rows.length > 0) {
            const order = orderResult.rows[0];

            if (order.status === 'CANCELLED') {
              // LATE PAYMENT PROTOCOL: Order was cancelled/expired before payment confirmation.
              // Do NOT reactivate order. Automatically issue full refund.
              console.warn(`[Webhook] Late payment captured for cancelled order ${order.id}. Initiating refund.`);
              await razorpayClient.payments.refund(payment.id, {
                amount: payment.amount,
                receipt: `ref_late_${order.id.slice(0, 20)}`,
                notes: { reason: 'Order expired prior to payment confirmation' },
              });

              await pool.query(
                `INSERT INTO refunds (payment_attempt_id, order_id, amount_paise, provider_refund_id, reason, status)
                 VALUES ($1, $2, $3, $4, 'Late payment refund for cancelled order', 'PROCESSED')`,
                [attempt.id, order.id, payment.amount, `rfnd_${Date.now()}`]
              );
            } else if (order.status === 'PENDING_PAYMENT') {
              // Transition to PAID_PENDING_MEETUP
              const client = await pool.connect();
              try {
                await client.query('BEGIN');
                await client.query(
                  `UPDATE payment_attempts
                   SET status = 'CAPTURED', provider_payment_id = $1, captured_at = NOW(), updated_at = NOW()
                   WHERE id = $2`,
                  [payment.id, attempt.id]
                );
                await client.query(
                  `UPDATE orders
                   SET status = 'PAID_PENDING_MEETUP', updated_at = NOW()
                   WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
                  [order.id]
                );
                await client.query('COMMIT');
              } catch (err) {
                await client.query('ROLLBACK');
                throw err;
              } finally {
                client.release();
              }
            }
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      if (payment && payment.order_id) {
        await pool.query(
          `UPDATE payment_attempts
           SET status = 'FAILED', failure_reason = $1, updated_at = NOW()
           WHERE provider_order_id = $2 AND status IN ('CREATED', 'PENDING')`,
          [payment.error_description || 'Payment failed', payment.order_id]
        );
      }
    } else if (eventType === 'refund.processed') {
      const refund = event.payload?.refund?.entity;
      if (refund && refund.id) {
        await pool.query(
          `UPDATE refunds
           SET status = 'PROCESSED', updated_at = NOW()
           WHERE provider_refund_id = $1`,
          [refund.id]
        );
      }
    }

    // Mark event processed
    await pool.query(
      `UPDATE payment_events SET processing_status = 'PROCESSED', processed_at = NOW() WHERE id = $1`,
      [dbEventId]
    );
  } catch (err: any) {
    await pool.query(
      `UPDATE payment_events SET processing_status = 'FAILED', error_message = $1 WHERE id = $2`,
      [err.message || 'Processing error', dbEventId]
    );
    throw err;
  }
}

/**
 * 4. Initiate Refund
 * Used when an order in PAID_PENDING_MEETUP is cancelled prior to physical meetup.
 */
export async function initiateRefund(orderId: string, userId: string, userRole: string, reason?: string): Promise<{ message: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Acquire row-level lock on the order
    const orderResult = await client.query(
      `SELECT id, buyer_id, status, total_amount FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error('Order not found.');
    }

    const order = orderResult.rows[0];

    // Authorization: User must be buyer, seller, or admin
    if (order.buyer_id !== userId && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      const sellerCheck = await client.query(
        `SELECT 1 FROM order_items WHERE order_id = $1 AND seller_id = $2 LIMIT 1`,
        [orderId, userId]
      );
      if (sellerCheck.rows.length === 0) {
        throw new Error('Unauthorized to cancel and refund this order.');
      }
    }

    if (order.status !== 'PAID_PENDING_MEETUP') {
      throw new Error(`Cannot refund order with status: ${order.status}. Must be in PAID_PENDING_MEETUP.`);
    }

    // Prevent duplicate refund
    const existingRefund = await client.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND status IN ('PENDING', 'PROCESSED')`,
      [orderId]
    );

    if (existingRefund.rows.length > 0) {
      throw new Error('A refund has already been requested or processed for this order.');
    }

    // Find captured payment attempt
    const attemptResult = await client.query(
      `SELECT id, provider_payment_id, amount_paise FROM payment_attempts
       WHERE order_id = $1 AND status = 'CAPTURED'
       LIMIT 1`,
      [orderId]
    );

    if (attemptResult.rows.length === 0 || !attemptResult.rows[0].provider_payment_id) {
      throw new Error('No captured payment found to refund.');
    }

    const attempt = attemptResult.rows[0];

    // Release reserved stock back to inventory
    const itemsResult = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE products
         SET reserved_stock = GREATEST(reserved_stock - $1, 0)
         WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Update order status to CANCELLED
    await client.query(
      `UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    // Call Razorpay Refund API
    const refundReceipt = `ref_${orderId.replace(/-/g, '').slice(0, 30)}`;
    const rzpRefund = await razorpayClient.payments.refund(attempt.provider_payment_id, {
      amount: Number(attempt.amount_paise),
      speed: 'normal',
      receipt: refundReceipt,
      notes: {
        orderId,
        reason: reason || 'Meetup cancelled prior to handover',
      },
    });

    // Record in refunds table
    await client.query(
      `INSERT INTO refunds (payment_attempt_id, order_id, amount_paise, provider_refund_id, receipt, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
      [attempt.id, orderId, attempt.amount_paise, rzpRefund.id, refundReceipt, reason || null]
    );

    await client.query('COMMIT');
    return { message: 'Refund initiated successfully. Funds will return in 5-7 business days.' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
