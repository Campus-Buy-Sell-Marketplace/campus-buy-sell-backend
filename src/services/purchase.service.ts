// ============================================================
// Campus Marketplace — Purchase Service (OTP Edition)
//
// Flow:
//   1. Lock product rows (FOR UPDATE NOWAIT)
//   2. Validate stock (available = stock - reserved_stock)
//   3. Reserve stock (increment reserved_stock) — do NOT deduct yet
//   4. Create order with status PENDING_MEETUP + generate OTP
//   5. Clear cart
//
// Stock is permanently deducted only when the seller verifies
// the delivery OTP (verifyDeliveryOtp in order.controller.ts).
// ============================================================

import pool from '../config/db';

export interface PurchaseLineItem {
  productId: string;
  quantity: number;
}

export interface OrderResult {
  orderId: string;
  totalAmount: number;
  deliveryOtp: string;
  paymentMethod: string;
  items: Array<{
    productId: string;
    title: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

/** Generate a 6-digit numeric OTP */
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * purchaseItems — Reserves stock and creates a PENDING_MEETUP order with OTP.
 *
 * Stock reservation (not deduction):
 *   • reserved_stock is incremented so other buyers see reduced availability.
 *   • Actual stock column is NOT touched until OTP is verified.
 *   • If order is cancelled, reserved_stock is decremented back.
 */
export async function purchaseItems(
  buyerId: string,
  lineItems: PurchaseLineItem[],
  paymentMethod: 'OFFLINE' | 'ONLINE' = 'OFFLINE'
): Promise<OrderResult> {
  if (!lineItems.length) {
    throw new Error('No items to purchase.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let totalAmount = 0;
    const resolvedItems: OrderResult['items'] = [];

    // ── 1. Lock rows, validate available stock, reserve ─────────────────────
    for (const { productId, quantity } of lineItems) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid quantity ${quantity} for product ${productId}.`);
      }

      // Lock the product row exclusively
      const lockResult = await client.query(
        `SELECT id, title, price, stock, reserved_stock, is_active, seller_id
         FROM products
         WHERE id = $1
         FOR UPDATE NOWAIT`,
        [productId]
      );

      if (lockResult.rows.length === 0) {
        throw new Error(`Product ${productId} not found.`);
      }

      const product = lockResult.rows[0];

      if (!product.is_active) {
        throw new Error(`"${product.title}" is no longer available.`);
      }

      // Available = total stock minus already reserved stock
      const available = product.stock - product.reserved_stock;
      if (available < quantity) {
        throw new Error(
          `Insufficient stock for "${product.title}". ` +
          `Available: ${available}, requested: ${quantity}.`
        );
      }

      const unitPrice = Number(product.price);
      const subtotal = unitPrice * quantity;
      totalAmount += subtotal;

      resolvedItems.push({
        productId,
        title: product.title,
        quantity,
        unitPrice,
        subtotal,
      });

      // ── 2. Reserve stock (increment reserved_stock, NOT deducting stock) ──
      await client.query(
        `UPDATE products
         SET reserved_stock = reserved_stock + $1
         WHERE id = $2`,
        [quantity, productId]
      );
    }

    // ── 3. Generate OTP ───────────────────────────────────────────────────────
    const deliveryOtp = generateOtp();

    // ── 4. Create the order ──────────────────────────────────────────────────
    const orderResult = await client.query(
      `INSERT INTO orders (buyer_id, status, total_amount, payment_method, delivery_otp)
       VALUES ($1, 'PENDING_MEETUP', $2, $3, $4)
       RETURNING id`,
      [buyerId, totalAmount, paymentMethod, deliveryOtp]
    );
    const orderId: string = orderResult.rows[0].id;

    // ── 5. Insert order items ────────────────────────────────────────────────
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, quantity, unit_price)
         SELECT $1, $2, seller_id, $3, $4
         FROM products WHERE id = $2`,
        [orderId, item.productId, item.quantity, item.unitPrice]
      );
    }

    // ── 6. Remove purchased items from the buyer's cart ──────────────────────
    const purchasedProductIds = lineItems.map((l) => l.productId);
    await client.query(
      `DELETE FROM cart_items
       WHERE user_id = $1 AND product_id = ANY($2::uuid[])`,
      [buyerId, purchasedProductIds]
    );

    await client.query('COMMIT');

    return { orderId, totalAmount, deliveryOtp, paymentMethod, items: resolvedItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
