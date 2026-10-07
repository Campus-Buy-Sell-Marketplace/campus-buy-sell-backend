// ============================================================
// Campus Marketplace — Order Routes
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { checkout, getMyOrders, getOrderById } from '../controllers/order.controller';

const router = Router();

// All order routes require authentication
router.use(authenticate);

// POST   /api/orders/checkout    — place an order (buy cart or specified items)
router.post('/checkout', checkout);

// GET    /api/orders             — current user's order history
router.get('/', getMyOrders);

// GET    /api/orders/:orderId    — single order detail
router.get('/:orderId', getOrderById);

export default router;
