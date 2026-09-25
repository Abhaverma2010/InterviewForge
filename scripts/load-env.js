// Loads .env when present. Real environment variables always win, so a
// deployment's settings are never overridden by a stray file.
// (process.loadEnvFile needs Node 20.12+; see "engines" in package.json.)
try {
  process.loadEnvFile('.env');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
