// A page or site we could not retrieve. `code` is stable and machine-readable
// (it ends up in the kit's list of skipped sources); `message` is for humans.
//
// Codes: INVALID_URL, BLOCKED_URL, DNS_FAILED, NETWORK, TIMEOUT, NOT_FOUND,
//        HTTP_ERROR, TOO_MANY_REDIRECTS, UNSUPPORTED_CONTENT_TYPE, TOO_LARGE,
//        ROBOTS_DISALLOWED
export class FetchError extends Error {
  constructor(code, message, { url, status, cause } = {}) {
    super(message, { cause });
    this.name = 'FetchError';
    this.code = code;
    this.url = url;
    this.status = status;
  }
}
