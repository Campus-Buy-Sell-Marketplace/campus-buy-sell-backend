// ============================================================
// Campus Marketplace — Razorpay Configuration
// ============================================================

import Razorpay from 'razorpay';

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export const razorpayClient = new Razorpay({
  key_id: RAZORPAY_KEY_ID || 'missing_key_id',
  key_secret: RAZORPAY_KEY_SECRET || 'missing_key_secret',
});
