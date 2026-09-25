import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';

// Import this to register the Google OAuth strategy (runs once on startup)
import './config/passport';

import authRoutes from './routes/auth.routes';
import sellerRoutes from './routes/seller.routes';
import adminRoutes from './routes/admin.routes';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean) as string[];

// Allow requests from the frontend (with cookies and bearer tokens)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Dev-friendly fallback
      }
    },
    credentials: true, // Required for cookies to be sent cross-origin
  })
);

// Parse JSON request bodies
app.use(express.json());

// Parse cookies (needed to read the JWT auth cookie)
app.use(cookieParser());

// Initialize Passport (required even when not using sessions)
app.use(passport.initialize());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/admin', adminRoutes);

// Health check — useful for verifying the server is running
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Campus Marketplace API is running 🚀' });
});

export default app;
