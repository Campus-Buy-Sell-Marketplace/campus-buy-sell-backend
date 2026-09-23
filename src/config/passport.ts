import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { findByGoogleId, findByEmail, createUser } from '../models/user.model';

// Configure Passport with the Google OAuth 2.0 strategy.
// This runs once when the server starts (imported in app.ts).
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: process.env.GOOGLE_CALLBACK_URL as string,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // Step 1: Try to find a user with this Google ID
        let user = await findByGoogleId(profile.id);

        if (user) {
          // User already exists — return them
          return done(null, user);
        }

        // Step 2: No user with this Google ID — check by email
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Google account has no email address.'), undefined);
        }

        user = await findByEmail(email);

        if (user) {
          // An email/password account already exists with this email.
          // For now, return the existing user (they can link accounts later).
          return done(null, user);
        }

        // Step 3: Brand new user — create an account
        const newUser = await createUser({
          name: profile.displayName || 'Campus User',
          email,
          google_id: profile.id,
          avatar_url: profile.photos?.[0]?.value,
        });

        return done(null, newUser);
      } catch (err) {
        return done(err as Error, undefined);
      }
    }
  )
);

export default passport;
