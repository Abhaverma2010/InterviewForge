// Reads the API's settings from environment variables (documented in
// .env.example) and refuses to start in production with unsafe values.

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    production,
    port: Number(env.PORT) || 4000,
    mongoUri: env.MONGODB_URI || null,
    sessionSecret: env.SESSION_SECRET || 'dev-only-secret',
    webOrigin: env.WEB_ORIGIN || 'http://localhost:3000',
    // Private addresses may only be crawled when explicitly allowed; never by default in production.
    allowPrivateUrls: env.ALLOW_PRIVATE_URLS === 'true',
    generationConcurrency: Number(env.GENERATION_CONCURRENCY) || 2,
  };

  if (production) {
    const problems = [];
    if (!config.mongoUri) problems.push('MONGODB_URI is required in production');
    if (
      !env.SESSION_SECRET ||
      env.SESSION_SECRET.length < 32 ||
      env.SESSION_SECRET === 'change-me'
    ) {
      problems.push('SESSION_SECRET must be a random string of at least 32 characters');
    }
    if (problems.length) throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return config;
}
