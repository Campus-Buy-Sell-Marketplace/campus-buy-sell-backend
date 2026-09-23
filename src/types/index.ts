// Shared TypeScript types for the backend
// These are used across controllers, models, and middleware

// The four user roles — must match the PostgreSQL enum exactly
export type UserRole = 'STUDENT' | 'SELLER' | 'ADMIN' | 'SUPER_ADMIN';

// Full user object (matches the users table in PostgreSQL)
export interface User {
  id: string;
  name: string;
  email: string;
  password?: string | null;   // Not returned to the client
  role: UserRole;
  google_id?: string | null;
  avatar_url?: string | null;
  created_at: Date;
  updated_at: Date;
}

// Data needed to create a new user
export interface CreateUserData {
  name: string;
  email: string;
  password?: string;          // Optional — Google users have no password
  google_id?: string;
  avatar_url?: string;
}

// What we store inside the JWT token
export interface JwtPayload {
  userId: string;
  role: UserRole;
}

// What the client receives after login (no password field)
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
  isSeller?: boolean;
  avatar?: string;
  createdAt?: string;
}

// Extend Express User so TypeScript knows about req.user (used by Passport and auth middleware)
declare global {
  namespace Express {
    interface User {
      id: string;
      role: UserRole;
    }
  }
}
