import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import {
  getStats,
  getUsers,
  updateUserRole,
  getSellerApplications,
  updateSellerApplicationStatus,
  getPayouts,
  markPayoutAsPaid,
  getEscrowOrders,
  confirmDeliveryAsAdmin,
} from '../controllers/admin.controller';

const router = Router();

// All admin routes require a valid JWT + ADMIN or SUPER_ADMIN role
router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN'));

// GET  /api/admin/stats         — dashboard stat cards (including pending seller apps & payouts)
router.get('/stats', getStats);

// GET  /api/admin/users         — full user list
router.get('/users', getUsers);

// PATCH /api/admin/users/:id/role — change a user's role
router.patch('/users/:id/role', updateUserRole);

// GET   /api/admin/seller-applications — list of all seller applications
router.get('/seller-applications', getSellerApplications);

// PATCH /api/admin/seller-applications/:id/status — approve or reject application
router.patch('/seller-applications/:id/status', updateSellerApplicationStatus);

// GET   /api/admin/payouts — list all seller payouts (supports ?status=PENDING)
router.get('/payouts', getPayouts);

// PATCH /api/admin/payouts/:id/mark-paid — record manual transfer reference & mark as PAID
router.patch('/payouts/:id/mark-paid', markPayoutAsPaid);

// GET   /api/admin/escrow-orders — orders currently held in escrow awaiting delivery
router.get('/escrow-orders', getEscrowOrders);

// POST  /api/admin/orders/:orderId/confirm-delivery — admin marks order delivered to release to payouts
router.post('/orders/:orderId/confirm-delivery', confirmDeliveryAsAdmin);

export default router;
