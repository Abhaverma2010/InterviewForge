import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlCompany, isSameSite } from '../src/retrieval/crawler.js';
import { createFetcher } from '../src/retrieval/fetcher.js';
import { createRobotsCache } from '../src/retrieval/robots.js';
import { page, startSite } from './helpers/site-server.js';

function makeDeps() {
  const fetcher = createFetcher({
    allowPrivate: true, // the fake sites run on 127.0.0.1
    minIntervalMs: 0,
    retries: 0,
    timeoutMs: 2000,
  });
  return { fetcher, robots: createRobotsCache(fetcher), sleep: async () => {} };
}

const HOW_WE_HIRE = page(
  'How we interview',
  `<main><h1>Our hiring process</h1>
   <p>After a recruiter screen you complete a take-home exercise.</p>
   <p>Then there is a system design interview and a final interview with the team.</p></main>`,
);

describe('crawlCompany on a site served under /acme/', () => {
  let site;
  before(async () => {
    site = await startSite({
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /acme/internal/' },
      '/acme/': page(
        'Acme — rockets for everyone',
        `<nav><a href="login">Log in</a></nav>
         <main><h1>Acme builds rockets</h1><p>We sell reusable rockets.</p>
         <a href="company/">Company</a>
         <a href="blog/2023/05/launch-day">Launch day recap</a>
         <a href="privacy">Privacy policy</a>
         <a href="internal/interview-notes">Interview notes</a>
         <a href="broken-careers">Careers</a>
         <a href="brochure">Careers brochure</a>
         <a href="https://twitter.com/acme">Twitter</a></main>`,
      ),
      // The hiring process sits two clicks deep at a path nobody would guess.
      '/acme/company/': page(
        'About Acme',
        `<main><p>Acme was founded in 2019 to make space affordable.</p>
         <a href="../company/people/">People &amp; Culture</a>
         <a href="/acme/">Home</a></main>`,
      ),
      '/acme/company/people/': HOW_WE_HIRE,
      '/acme/brochure': { type: 'application/pdf', body: '%PDF-1.4' },
      '/acme/internal/interview-notes': page('Secret', '<p>Should never be fetched</p>'),
    });
  });
  after(() => site.close());

  test('finds the hiring page by following relative links', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps());
    assert.equal(result.reachable, true);
    assert.equal(result.hiringPage, `${site.origin}/acme/company/people/`);
    assert.equal(result.aboutPage, `${site.origin}/acme/company/`);
    const hiring = result.pages.find((p) => p.url === result.hiringPage);
    assert.match(hiring.text, /take-home exercise/);
  });

  test('respects robots.txt and records the skip', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps());
    assert.ok(!site.hits.includes('/acme/internal/interview-notes'));
    assert.ok(
      result.skipped.some(
        (s) => s.url.endsWith('/acme/internal/interview-notes') && s.code === 'ROBOTS_DISALLOWED',
      ),
    );
  });

  test('records broken links and non-HTML pages without failing', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps());
    const codes = Object.fromEntries(result.skipped.map((s) => [new URL(s.url).pathname, s.code]));
    assert.equal(codes['/acme/broken-careers'], 'NOT_FOUND');
    assert.equal(codes['/acme/brochure'], 'UNSUPPORTED_CONTENT_TYPE');
  });

  test('never fetches useless or external pages', async () => {
    site.hits.length = 0;
    await crawlCompany(`${site.origin}/acme/`, makeDeps());
    for (const path of ['/acme/login', '/acme/privacy']) {
      assert.ok(!site.hits.includes(path), `fetched ${path}`);
    }
  });

  test('stops at maxPages', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps(), { maxPages: 2 });
    assert.equal(result.pages.length, 2);
  });

  test('stops at maxDepth', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps(), { maxDepth: 1 });
    assert.equal(result.hiringPage, null);
    assert.ok(result.pages.every((p) => p.depth <= 1));
  });

  test('strips navigation and scripts from page text', async () => {
    const result = await crawlCompany(`${site.origin}/acme/`, makeDeps());
    const home = result.pages[0];
    assert.equal(home.kind, 'home');
    assert.match(home.text, /We sell reusable rockets/);
    assert.doesNotMatch(home.text, /Log in/);
  });
});

describe('crawlCompany edge cases', () => {
  test('a site with no hiring page is reachable but reports none', async () => {
    const site = await startSite({
      '/': page('Plain Co', '<p>We make chairs.</p><a href="/about">About us</a>'),
      '/about': page('About', '<p>Family business since 1950.</p>'),
    });
    try {
      const result = await crawlCompany(`${site.origin}/`, makeDeps());
      assert.equal(result.reachable, true);
      assert.equal(result.hiringPage, null);
      assert.equal(result.aboutPage, `${site.origin}/about`);
    } finally {
      await site.close();
    }
  });

  test('a homepage that returns 404 makes the site unreachable', async () => {
    const site = await startSite({});
    try {
      const result = await crawlCompany(`${site.origin}/missing/`, makeDeps());
      assert.equal(result.reachable, false);
      assert.equal(result.error.code, 'NOT_FOUND');
    } finally {
      await site.close();
    }
  });

  test('a closed port is reported as a network failure', async () => {
    const site = await startSite({});
    const { origin } = site;
    await site.close();
    const result = await crawlCompany(`${origin}/`, makeDeps());
    assert.equal(result.reachable, false);
    assert.equal(result.error.code, 'NETWORK');
  });

  test('a slow homepage times out', async () => {
    const site = await startSite({ '/': { body: page('Slow', ''), delayMs: 1500 } });
    try {
      const fetcher = createFetcher({
        allowPrivate: true,
        minIntervalMs: 0,
        retries: 0,
        timeoutMs: 200,
      });
      const result = await crawlCompany(`${site.origin}/`, {
        fetcher,
        robots: createRobotsCache(fetcher),
      });
      assert.equal(result.reachable, false);
      assert.equal(result.error.code, 'TIMEOUT');
    } finally {
      await site.close();
    }
  });

  test('an invalid URL is reported, not thrown', async () => {
    const result = await crawlCompany('not a url', makeDeps());
    assert.equal(result.reachable, false);
    assert.equal(result.error.code, 'INVALID_URL');
  });

  test('a page reached through an innocent link is classified by its content', async () => {
    const site = await startSite({
      '/': page('Co', '<a href="/company">Company</a>'),
      '/company': HOW_WE_HIRE,
    });
    try {
      const result = await crawlCompany(`${site.origin}/`, makeDeps());
      assert.equal(result.hiringPage, `${site.origin}/company`);
    } finally {
      await site.close();
    }
  });
});

describe('isSameSite', () => {
  const start = new URL('https://about.gitlab.com/');
  test('accepts sibling subdomains and www', () => {
    assert.ok(isSameSite(new URL('https://handbook.gitlab.com/hiring'), start));
    assert.ok(isSameSite(new URL('https://www.about.gitlab.com/'), start));
  });
  test('rejects other domains', () => {
    assert.ok(!isSameSite(new URL('https://gitlab.example.com/'), start));
    assert.ok(!isSameSite(new URL('https://co.uk/'), new URL('https://acme.co.uk/')));
  });
  test('requires an exact host and port for localhost', () => {
    const local = new URL('http://localhost:8099/acme/');
    assert.ok(isSameSite(new URL('http://localhost:8099/acme/jobs'), local));
    assert.ok(!isSameSite(new URL('http://localhost:9000/'), local));
  });
});
