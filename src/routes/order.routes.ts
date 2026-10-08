// ============================================================
// Campus Marketplace — Order Routes (OTP Edition)
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  checkout,
  getMyOrders,
  getOrderById,
  verifyDeliveryOtp,
  getSellerOrders,
} from '../controllers/order.controller';

const router = Router();

// All order routes require authentication
router.use(authenticate);

// POST   /api/orders/checkout              — place an order
router.post('/checkout', checkout);

// GET    /api/orders/seller/incoming       — seller's incoming orders (must be before /:orderId)
router.get('/seller/incoming', getSellerOrders);

// GET    /api/orders                       — buyer's order history
router.get('/', getMyOrders);

// GET    /api/orders/:orderId              — single order detail
router.get('/:orderId', getOrderById);

// POST   /api/orders/:orderId/verify-otp   — seller verifies delivery OTP
router.post('/:orderId/verify-otp', verifyDeliveryOtp);

export default router;
