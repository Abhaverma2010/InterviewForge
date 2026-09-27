// Registration, login, logout and "who am I", on server-side sessions.
// The session cookie is httpOnly, so page scripts cannot read it.

import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, handle, rateLimit, validateBody } from '../http.js';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

// Compared against when the email is unknown, so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRoutes({ store }) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: 30, code: 'TOO_MANY_ATTEMPTS' });

  router.post(
    '/register',
    limiter,
    validateBody(credentials),
    handle(async (req, res) => {
      const passwordHash = await bcrypt.hash(req.body.password, 10);
      let user;
      try {
        user = await store.users.create({ email: req.body.email, passwordHash });
      } catch (err) {
        if (err.code === 'EMAIL_TAKEN') {
          throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
        }
        throw err;
      }
      await startSession(req, user);
      res.status(201).json({ user });
    }),
  );

  router.post(
    '/login',
    limiter,
    validateBody(
      credentials.pick({ email: true }).extend({ password: z.string().min(1).max(200) }),
    ),
    handle(async (req, res) => {
      const found = await store.users.findByEmail(req.body.email);
      const ok = await bcrypt.compare(req.body.password, found?.passwordHash ?? DUMMY_HASH);
      if (!found || !ok) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      const { passwordHash, ...user } = found;
      await startSession(req, user);
      res.json({ user });
    }),
  );

  router.post(
    '/logout',
    handle(async (req, res) => {
      await new Promise((resolve, reject) =>
        req.session.destroy((err) => (err ? reject(err) : resolve())),
      );
      res.clearCookie('ifsid');
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    handle(async (req, res) => {
      const user = req.session.userId ? await store.users.findById(req.session.userId) : null;
      if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in.');
      res.json({ user });
    }),
  );

  return router;
}

/** Only signed-in users get past this; the route then sees req.userId. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return next(
      new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please log in again.'),
    );
  }
  req.userId = req.session.userId;
  next();
}

// A fresh session id on login prevents session fixation.
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}
