import http from 'node:http';

/**
 * Serves a fake website on a random localhost port.
 *
 * @param {Record<string, string | { status?: number, type?: string, body?: string,
 *   headers?: Record<string, string>, delayMs?: number }>} routes
 *   path (with query) → HTML string, or a full response description
 */
export async function startSite(routes) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    hits.push(req.url);
    const route = routes[req.url];
    if (route === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>Not found</h1>');
      return;
    }
    const spec = typeof route === 'string' ? { body: route } : route;
    if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
    if (res.destroyed) return;
    res.writeHead(spec.status ?? 200, {
      'Content-Type': spec.type ?? 'text/html; charset=utf-8',
      ...spec.headers,
    });
    res.end(spec.body ?? '');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

export const page = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
