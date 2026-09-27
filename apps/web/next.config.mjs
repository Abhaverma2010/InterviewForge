// The browser only ever talks to this app. Requests to /api/* are forwarded
// to the Express API, so the session cookie is first-party and no CORS is
// needed. API_ORIGIN is read at build time (set it in the host's env).
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  poweredByHeader: false,
};

export default nextConfig;
