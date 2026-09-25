import { createFetcher } from './fetcher.js';
import { createRobotsCache } from './robots.js';

export { crawlCompany } from './crawler.js';
export { extractPageContent } from './extract.js';
export { FetchError } from './errors.js';
export { createFetcher, createRobotsCache };
export { validateUrl } from './url-safety.js';

/** A fetcher and robots cache that share settings, ready for crawlCompany(). */
export function createCrawlerDeps(fetcherOptions = {}) {
  const fetcher = createFetcher(fetcherOptions);
  return { fetcher, robots: createRobotsCache(fetcher) };
}
