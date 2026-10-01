// ============================================================
// Campus Marketplace — Product Routes
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getMyProducts,
} from '../controllers/product.controller';

const router = Router();

// ── Public routes (no auth needed) ───────────────────────────────────────────
router.get('/', getProducts);
router.get('/:id', getProductById);

// ── Seller-only routes ────────────────────────────────────────────────────────
router.get(
  '/seller/my-listings',
  authenticate,
  requireRole('SELLER', 'ADMIN', 'SUPER_ADMIN'),
  getMyProducts
);
router.post(
  '/',
  authenticate,
  requireRole('SELLER', 'ADMIN', 'SUPER_ADMIN'),
  createProduct
);
router.patch(
  '/:id',
  authenticate,
  requireRole('SELLER', 'ADMIN', 'SUPER_ADMIN'),
  updateProduct
);
router.delete(
  '/:id',
  authenticate,
  requireRole('SELLER', 'ADMIN', 'SUPER_ADMIN'),
  deleteProduct
);

export default router;
