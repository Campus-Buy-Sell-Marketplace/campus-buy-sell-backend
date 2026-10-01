// ============================================================
// Campus Marketplace — Cart Routes
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from '../controllers/cart.controller';

const router = Router();

// All cart routes require authentication
router.use(authenticate);

// GET    /api/cart               — fetch user's cart
router.get('/', getCart);

// POST   /api/cart               — add item to cart
router.post('/', addToCart);

// PATCH  /api/cart/:itemId       — update item quantity
router.patch('/:itemId', updateCartItem);

// DELETE /api/cart               — clear entire cart
router.delete('/', clearCart);

// DELETE /api/cart/:itemId       — remove single item
router.delete('/:itemId', removeFromCart);

export default router;
