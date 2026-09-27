// Builds the Express app from its dependencies, without starting it, so tests
// can run it with an in-memory store and a fake model.

import express from 'express';
import session from 'express-session';
import { errorHandler, notFound } from './http.js';
import { authRoutes } from './routes/auth.js';
import { kitRoutes } from './routes/kits.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {object} deps.store  see store/memory.js for the interface
 * @param {object} deps.queue  generation queue
 * @param {object} deps.llm  LLM client (for regeneration)
 * @param {object} deps.crawler  { fetcher, robots } (for brief regeneration)
 * @param {object} deps.config  from loadConfig()
 * @param {session.Store} [deps.sessionStore]  defaults to memory (tests, local dev)
 */
export function createApp({ store, queue, llm, crawler, config, sessionStore, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1); // behind the host's HTTPS proxy

  app.use(securityHeaders);
  app.use(cors(config.webOrigin));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'ifsid',
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true, // active users stay signed in; idle sessions expire
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
        maxAge: WEEK_MS,
      },
    }),
  );

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes({ store }));
  app.use('/api/kits', kitRoutes({ store, queue, llm, crawler }));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
}

// The web app normally reaches the API through its own /api rewrite (same
// origin). This allows direct calls from the configured frontend origin too.
function cors(origin) {
  return (req, res, next) => {
    if (req.headers.origin && req.headers.origin === origin) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  };
}
