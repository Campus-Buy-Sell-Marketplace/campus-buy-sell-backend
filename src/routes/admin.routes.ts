import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import {
  getStats,
  getUsers,
  updateUserRole,
  getSellerApplications,
  updateSellerApplicationStatus,
} from '../controllers/admin.controller';

const router = Router();

// All admin routes require a valid JWT + ADMIN or SUPER_ADMIN role
router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN'));

// GET  /api/admin/stats         — dashboard stat cards (including pending seller apps)
router.get('/stats', getStats);

// GET  /api/admin/users         — full user list
router.get('/users', getUsers);

// PATCH /api/admin/users/:id/role — change a user's role
router.patch('/users/:id/role', updateUserRole);

// GET   /api/admin/seller-applications — list of all seller applications
router.get('/seller-applications', getSellerApplications);

// PATCH /api/admin/seller-applications/:id/status — approve or reject application
router.patch('/seller-applications/:id/status', updateSellerApplicationStatus);

export default router;
