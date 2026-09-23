import express from 'express';

// Builds the Express app without starting it, so tests can import it.
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}
