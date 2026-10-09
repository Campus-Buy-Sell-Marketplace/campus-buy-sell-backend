// ============================================================
// Campus Marketplace — Chat Routes
// ============================================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getMessages, sendMessage } from '../controllers/chat.controller';

const router = Router();

router.use(authenticate);

// GET  /api/chat/:orderId  — fetch all messages for an order
router.get('/:orderId', getMessages);

// POST /api/chat/:orderId  — send a message
router.post('/:orderId', sendMessage);

export default router;
