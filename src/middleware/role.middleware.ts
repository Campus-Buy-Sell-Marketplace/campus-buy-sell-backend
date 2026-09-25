import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';

/**
 * requireRole middleware
 *
 * Use AFTER authenticate middleware.
 * Allows only users whose role is in the allowed list.
 *
 * Example: router.get('/stats', authenticate, requireRole('ADMIN','SUPER_ADMIN'), handler)
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role as UserRole)) {
      res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
      return;
    }
    next();
  };
}
