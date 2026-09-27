// HTTP plumbing shared by the routes: a structured error type, request
// validation, the error handler and a small rate limiter.
//
// Every error reaches the client as
//   { "error": { "code": "VERSION_CONFLICT", "message": "...", "details": ... } }
// so the interface can react to the code and show the message.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Parses req.body with a zod schema, or answers 400 with the problems. */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(new ApiError(400, 'INVALID_REQUEST', 'The request is not valid.', details));
    }
    req.body = result.data;
    next();
  };
}

/** Wraps an async handler so a rejected promise reaches the error handler. */
export const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}.`));
}

export function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      err = new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
    } else if (err.type === 'entity.too.large') {
      err = new ApiError(413, 'TOO_LARGE', 'The request body is too large.');
    }
    if (!(err instanceof ApiError)) {
      logger.error(err);
      err = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.');
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  };
}

/**
 * Fixed-window limiter keyed by client IP, for endpoints worth protecting
 * from brute force (login) or abuse (kit creation). In memory, which is fine
 * for a single instance.
 */
export function rateLimit({ windowMs, max, code = 'RATE_LIMITED' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return next(
        new ApiError(429, code, 'Too many requests. Please wait a moment and try again.'),
      );
    }
    next();
  };
}
