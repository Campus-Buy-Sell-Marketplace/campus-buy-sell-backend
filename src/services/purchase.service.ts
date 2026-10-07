// ============================================================
// Campus Marketplace — Purchase Service
// Race-condition-safe inventory deduction using:
//  • PostgreSQL transactions (BEGIN / COMMIT / ROLLBACK)
//  • Row-level locking (SELECT … FOR UPDATE)
//  • Post-lock stock check before decrementing
// ============================================================

import pool from '../config/db';

export interface PurchaseLineItem {
  productId: string;
  quantity: number;
}

export interface OrderResult {
  orderId: string;
  totalAmount: number;
  items: Array<{
    productId: string;
    title: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

/**
 * purchaseItems — Creates a single order for all items atomically.
 *
 * For each product:
 *   1. Acquire an exclusive row lock (SELECT … FOR UPDATE NOWAIT).
 *   2. Re-read stock AFTER the lock is held.
 *   3. Reject immediately if stock < requested quantity.
 *   4. Deduct stock.
 * Then:
 *   5. Insert the order + all order_items in the same transaction.
 *   6. Clear the user's cart for the purchased items.
 *
 * If any step fails the entire transaction rolls back — inventory is safe.
 */
export async function purchaseItems(
  buyerId: string,
  lineItems: PurchaseLineItem[]
): Promise<OrderResult> {
  if (!lineItems.length) {
    throw new Error('No items to purchase.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let totalAmount = 0;
    const resolvedItems: OrderResult['items'] = [];

    // ── 1. Lock rows and validate stock ─────────────────────────────────────
    for (const { productId, quantity } of lineItems) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Invalid quantity ${quantity} for product ${productId}.`);
      }

      // Lock the product row so concurrent transactions must wait
      const lockResult = await client.query(
        `SELECT id, title, price, stock, is_active, seller_id
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

      // Check stock AFTER acquiring lock (prevents race conditions)
      if (product.stock < quantity) {
        throw new Error(
          `Insufficient stock for "${product.title}". ` +
          `Available: ${product.stock}, requested: ${quantity}.`
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

      // ── 2. Deduct stock within the same transaction ──────────────────────
      await client.query(
        `UPDATE products
         SET stock      = stock - $1,
             is_active  = CASE WHEN stock - $1 = 0 THEN FALSE ELSE is_active END
         WHERE id = $2`,
        [quantity, productId]
      );
    }

    // ── 3. Create the order ──────────────────────────────────────────────────
    const orderResult = await client.query(
      `INSERT INTO orders (buyer_id, status, total_amount)
       VALUES ($1, 'CONFIRMED', $2)
       RETURNING id`,
      [buyerId, totalAmount]
    );
    const orderId: string = orderResult.rows[0].id;

    // ── 4. Insert order items ────────────────────────────────────────────────
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, quantity, unit_price)
         SELECT $1, $2, seller_id, $3, $4
         FROM products WHERE id = $2`,
        [orderId, item.productId, item.quantity, item.unitPrice]
      );
    }

    // ── 5. Remove purchased items from the buyer's cart ──────────────────────
    const purchasedProductIds = lineItems.map((l) => l.productId);
    await client.query(
      `DELETE FROM cart_items
       WHERE user_id = $1 AND product_id = ANY($2::uuid[])`,
      [buyerId, purchasedProductIds]
    );

    await client.query('COMMIT');

    return { orderId, totalAmount, items: resolvedItems };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
