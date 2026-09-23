import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { findByEmail, findById, findByGoogleId, createUser } from '../models/user.model';
import { JwtPayload, PublicUser, User } from '../types';

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Signs a JWT, sets it as an HTTP-only cookie, and returns the token string.
 * The token is returned in the body so the frontend can store it in localStorage.
 */
function signToken(user: User): string {
  const payload: JwtPayload = { userId: user.id, role: user.role };
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn });
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,                                         // Not accessible via JS
    secure: process.env.NODE_ENV === 'production',         // HTTPS only in production
    sameSite: 'lax',                                       // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000,                       // 7 days in milliseconds
  });
}

/** Build the public user object — never includes the password.
 *  Shape matches what the frontend's AuthResponse.user expects.
 */
function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_url: user.avatar_url,
    // isSeller: true when role is SELLER (frontend uses this for seller mode toggle)
    isSeller: user.role === 'SELLER',
    avatar: user.avatar_url ?? undefined,
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : undefined,
  };
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 *
 * Flow:
 * 1. Validate request body (email + password)
 * 2. Find the user by email in PostgreSQL
 * 3. Compare submitted password with the bcrypt hash
 * 4. Issue a JWT cookie + token in response body
 * 5. Return token + user info
 */
export async function loginWithEmail(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ message: errors.array()[0].msg });
    return;
  }

  const { email, password } = req.body as { email: string; password: string };

  try {
    const user = await findByEmail(email);

    if (!user || !user.password) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error('[loginWithEmail] error:', err);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
}

/**
 * POST /api/auth/google
 *
 * Called by frontend when user signs in with @react-oauth/google.
 * Receives the Google ID token in request body ({ token: googleIdToken }).
 */
export async function loginWithGoogleToken(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ message: 'Google credential token is required.' });
    return;
  }

  try {
    // Verify token with Google's public tokeninfo endpoint
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!googleRes.ok) {
      res.status(401).json({ message: 'Invalid Google token.' });
      return;
    }

    const googlePayload: any = await googleRes.json();
    const { email, name, sub: googleId, picture } = googlePayload;

    if (!email) {
      res.status(400).json({ message: 'Google account does not have a verified email.' });
      return;
    }

    // Check if user already exists by googleId or email
    let user = await findByGoogleId(googleId);

    if (!user) {
      user = await findByEmail(email);
    }

    if (!user) {
      // Create new student user in Neon PostgreSQL
      user = await createUser({
        name: name || email.split('@')[0],
        email,
        google_id: googleId,
        avatar_url: picture,
      });
    }

    const jwtToken = signToken(user);
    setAuthCookie(res, jwtToken);

    res.json({
      token: jwtToken,
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error('[loginWithGoogleToken] error:', err);
    res.status(500).json({ message: 'Server error during Google authentication.' });
  }
}

/**
 * GET /api/auth/me
 *
 * Called by the frontend on every app load to restore the session.
 * The authenticate middleware already verified the JWT (via cookie or Bearer token).
 * Returns both user directly and { user: ... } for complete compatibility.
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const user = await findById(req.user!.id);

    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const publicUser = toPublicUser(user);
    res.json({
      ...publicUser,
      user: publicUser,
    });
  } catch (err) {
    console.error('[getMe] error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
}

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
export function logout(_req: Request, res: Response): void {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully.' });
}

/**
 * GET /api/auth/google/callback (for traditional OAuth redirect flow)
 */
export function googleAuthCallback(req: Request, res: Response): void {
  const user = req.user as unknown as User;
  const token = signToken(user);
  setAuthCookie(res, token);
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  res.redirect(`${clientUrl}/home`);
}
