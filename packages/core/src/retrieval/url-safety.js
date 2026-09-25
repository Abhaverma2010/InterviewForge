// Decides whether a URL is safe for the server to fetch.
//
// We fetch addresses that users (and crawled pages) give us, so without this
// check someone could point the crawler at our own infrastructure: localhost,
// the cloud metadata service at 169.254.169.254, or a private network. That
// attack is called SSRF (server-side request forgery).
//
// In production private addresses are rejected. Locally, and for the batch
// evaluator whose test sites are served from localhost, ALLOW_PRIVATE_URLS
// turns the check off.

import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { FetchError } from './errors.js';

/**
 * Parses and checks a URL. Returns a URL object or throws FetchError.
 *
 * @param {string | URL} input
 * @param {object} [opts]
 * @param {boolean} [opts.allowPrivate]  allow localhost / private networks
 * @param {typeof lookup} [opts.lookupImpl]  DNS lookup, replaceable in tests
 */
export async function validateUrl(input, { allowPrivate = false, lookupImpl = lookup } = {}) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('INVALID_URL', `Not a valid URL: ${input}`, { url: String(input) });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('INVALID_URL', `Only http and https URLs are supported: ${url.href}`, {
      url: url.href,
    });
  }
  if (url.username || url.password) {
    throw new FetchError('INVALID_URL', 'URLs with embedded credentials are not allowed.', {
      url: url.href,
    });
  }
  if (allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6 literals come wrapped in []
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw blocked(url);
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookupImpl(host, { all: true })).map((a) => a.address);
    } catch (err) {
      throw new FetchError('DNS_FAILED', `Could not resolve ${host}.`, {
        url: url.href,
        cause: err,
      });
    }
  }
  if (addresses.some(isPrivateAddress)) throw blocked(url);
  return url;
}

function blocked(url) {
  return new FetchError(
    'BLOCKED_URL',
    `Refusing to fetch a private or local address: ${url.href}`,
    {
      url: url.href,
    },
  );
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIPv4(address);
  if (!net.isIPv6(address)) return true; // not an IP at all: refuse

  const ip = address.toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (ip === '::' || ip === '::1') return true;
  return /^(fc|fd|fe[89ab]|ff)/.test(ip); // unique-local, link-local, multicast
}

function isPrivateIPv4(address) {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}
