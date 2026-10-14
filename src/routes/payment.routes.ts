// ============================================================
// Campus Marketplace — Payment Routes
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  initPayment,
  verifyPayment,
  handleWebhook,
  refundPayment,
  getPaymentStatus,
} from '../controllers/payment.controller';

const router = Router();

// Public webhook route (signature-verified in controller)
router.post('/webhook', handleWebhook);

// Protected routes (require user login)
router.post('/init', authenticate, initPayment);
router.post('/verify', authenticate, verifyPayment);
router.post('/:orderId/refund', authenticate, refundPayment);
router.get('/orders/:orderId/status', authenticate, getPaymentStatus);

export default router;
