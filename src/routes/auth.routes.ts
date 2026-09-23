import { Router } from 'express';
import { body } from 'express-validator';
import passport from 'passport';
import {
  loginWithEmail,
  loginWithGoogleToken,
  getMe,
  logout,
  googleAuthCallback,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// ─── Email + Password ─────────────────────────────────────────────────────────

// POST /api/auth/login
// Validates email + password, then calls the controller
router.post(
  '/login',
  [
    body('email')
      .trim()
      .isEmail()
      .withMessage('Please enter a valid email address.'),
    body('password')
      .notEmpty()
      .withMessage('Password is required.'),
  ],
  loginWithEmail
);

// ─── Session / Me ─────────────────────────────────────────────────────────────

// GET /api/auth/me
// Returns the currently authenticated user's info (called on every app load)
router.get('/me', authenticate, getMe);

// ─── Logout ───────────────────────────────────────────────────────────────────

// POST /api/auth/logout
router.post('/logout', logout);

// ─── Google OAuth ─────────────────────────────────────────────────────────────

// POST /api/auth/google  →  called by frontend @react-oauth/google with { token: googleIdToken }
router.post('/google', loginWithGoogleToken);

// GET /api/auth/google  →  redirects to Google's consent screen (traditional OAuth)
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// GET /api/auth/google/callback  →  Google redirects here after the user consents
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.CLIENT_URL}/login?error=google_failed`,
    session: false,
  }),
  googleAuthCallback
);

export default router;
