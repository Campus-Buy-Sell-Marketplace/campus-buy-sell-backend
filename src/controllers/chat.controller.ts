// ============================================================
// Campus Marketplace — Chat Controller
// Handles order-scoped messages between buyer and seller.
//
// Routes:
//   GET  /api/chat/:orderId        — fetch all messages for an order
//   POST /api/chat/:orderId        — send a message in an order chat
// ============================================================

import { Request, Response } from 'express';
import pool from '../config/db';

// ── GET /api/chat/:orderId ─────────────────────────────────────────────────────
// Fetches all messages for an order.
// Only the buyer or a seller with an item in the order can access.
export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;

    // Verify this user is either the buyer or a seller of the order
    const accessCheck = await pool.query(
      `SELECT o.id
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.seller_id = $2
       WHERE o.id = $1 AND (o.buyer_id = $2 OR oi.seller_id = $2)
       LIMIT 1`,
      [orderId, userId]
    );

    if (accessCheck.rows.length === 0) {
      res.status(403).json({ message: 'Access denied. You are not part of this order.' });
      return;
    }

    const result = await pool.query(
      `SELECT
         m.id,
         m.order_id,
         m.sender_id,
         u.name AS sender_name,
         u.role AS sender_role,
         m.message,
         m.created_at
       FROM order_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.order_id = $1
       ORDER BY m.created_at ASC`,
      [orderId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('[chat.getMessages] error:', err);
    res.status(500).json({ message: 'Failed to fetch messages.' });
  }
}

// ── POST /api/chat/:orderId ────────────────────────────────────────────────────
// Sends a new message in an order chat.
// Only buyer or seller involved in the order can send.
export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { orderId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ message: 'Message cannot be empty.' });
      return;
    }

    if (message.trim().length > 1000) {
      res.status(400).json({ message: 'Message is too long (max 1000 characters).' });
      return;
    }

    // Verify this user is either the buyer or a seller of the order
    const accessCheck = await pool.query(
      `SELECT o.id
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.seller_id = $2
       WHERE o.id = $1 AND (o.buyer_id = $2 OR oi.seller_id = $2)
       LIMIT 1`,
      [orderId, userId]
    );

    if (accessCheck.rows.length === 0) {
      res.status(403).json({ message: 'Access denied. You are not part of this order.' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO order_messages (order_id, sender_id, message)
       VALUES ($1, $2, $3)
       RETURNING
         id, order_id, sender_id, message, created_at`,
      [orderId, userId, message.trim()]
    );

    // Enrich with sender info
    const userInfo = await pool.query(
      'SELECT name, role FROM users WHERE id = $1',
      [userId]
    );

    const msg = {
      ...result.rows[0],
      sender_name: userInfo.rows[0]?.name,
      sender_role: userInfo.rows[0]?.role,
    };

    res.status(201).json({ message: msg });
  } catch (err) {
    console.error('[chat.sendMessage] error:', err);
    res.status(500).json({ message: 'Failed to send message.' });
  }
}
