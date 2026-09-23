import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

/**
 * authenticate middleware
 *
 * Reads the JWT from the HTTP-only cookie named 'token'.
 * If valid, attaches { id, role } to req.user and calls next().
 * If missing or invalid, responds with 401.
 *
 * Use this on any route that requires a logged-in user.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined = req.cookies?.token;

  // Fallback to Bearer token in Authorization header (used by localStorage auth)
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ message: 'Not authenticated. Please log in.' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    req.user = { id: payload.userId, role: payload.role };
    next();
  } catch {
    // Token is expired or tampered
    res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}
