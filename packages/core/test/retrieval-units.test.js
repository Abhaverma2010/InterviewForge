import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, extractPageContent } from '../src/retrieval/extract.js';
import { createFetcher } from '../src/retrieval/fetcher.js';
import { looksLikeHiringProcess, scoreLink } from '../src/retrieval/link-scoring.js';
import { parseRobots } from '../src/retrieval/robots.js';
import { isPrivateAddress, validateUrl } from '../src/retrieval/url-safety.js';

describe('validateUrl', () => {
  const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateDns = async () => [{ address: '10.0.0.5', family: 4 }];

  test('accepts a public http(s) URL', async () => {
    const url = await validateUrl('https://example.com/jobs', { lookupImpl: publicDns });
    assert.equal(url.href, 'https://example.com/jobs');
  });

  test('rejects malformed URLs and non-web schemes', async () => {
    for (const input of [
      'not a url',
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      await assert.rejects(validateUrl(input, { lookupImpl: publicDns }), { code: 'INVALID_URL' });
    }
  });

  test('rejects credentials in the URL', async () => {
    await assert.rejects(validateUrl('https://user:pw@example.com', { lookupImpl: publicDns }), {
      code: 'INVALID_URL',
    });
  });

  test('rejects private, loopback and metadata addresses', async () => {
    for (const input of [
      'http://127.0.0.1/',
      'http://localhost:3000/',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.1/',
      'http://[::1]/',
    ]) {
      await assert.rejects(validateUrl(input, { lookupImpl: publicDns }), { code: 'BLOCKED_URL' });
    }
  });

  test('rejects a hostname that resolves to a private address', async () => {
    await assert.rejects(validateUrl('https://sneaky.example/', { lookupImpl: privateDns }), {
      code: 'BLOCKED_URL',
    });
  });

  test('allows private addresses when allowPrivate is set', async () => {
    const url = await validateUrl('http://localhost:8099/acme/', { allowPrivate: true });
    assert.equal(url.host, 'localhost:8099');
  });
});

describe('isPrivateAddress', () => {
  test('classifies addresses', () => {
    for (const ip of [
      '10.1.2.3',
      '172.20.0.1',
      '100.64.0.1',
      '0.0.0.0',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      assert.ok(isPrivateAddress(ip), ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      assert.ok(!isPrivateAddress(ip), ip);
    }
  });
});

describe('fetcher', () => {
  const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

  test('re-validates redirects, so a public page cannot bounce us to a private one', async () => {
    const fetcher = createFetcher({
      lookupImpl: publicDns,
      minIntervalMs: 0,
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    });
    await assert.rejects(fetcher.fetchText('https://example.com/'), { code: 'BLOCKED_URL' });
  });

  test('retries a 503 and then succeeds', async () => {
    const responses = [
      new Response('busy', { status: 503 }),
      new Response('<p>ok</p>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ];
    const fetcher = createFetcher({
      lookupImpl: publicDns,
      minIntervalMs: 0,
      sleep: async () => {},
      fetchImpl: async () => responses.shift(),
    });
    const res = await fetcher.fetchText('https://example.com/');
    assert.equal(res.body, '<p>ok</p>');
  });

  test('truncates pages larger than maxBytes instead of dropping them', async () => {
    const fetcher = createFetcher({
      lookupImpl: publicDns,
      minIntervalMs: 0,
      maxBytes: 10,
      fetchImpl: async () =>
        new Response('x'.repeat(100), { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const res = await fetcher.fetchText('https://example.com/');
    assert.equal(res.body, 'x'.repeat(10));
    assert.equal(res.truncated, true);
  });

  test('refuses a page that declares an absurd size', async () => {
    const fetcher = createFetcher({
      lookupImpl: publicDns,
      minIntervalMs: 0,
      hardMaxBytes: 1000,
      fetchImpl: async () =>
        new Response('x', {
          status: 200,
          headers: { 'content-type': 'text/html', 'content-length': '5000' },
        }),
    });
    await assert.rejects(fetcher.fetchText('https://example.com/'), { code: 'TOO_LARGE' });
  });

  test('spaces out requests to the same host', async () => {
    let clock = 0;
    const waits = [];
    const fetcher = createFetcher({
      lookupImpl: publicDns,
      minIntervalMs: 500,
      now: () => clock,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () =>
        new Response('', { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    await fetcher.fetchText('https://example.com/a');
    await fetcher.fetchText('https://example.com/b');
    assert.deepEqual(waits, [500]);
  });
});

describe('parseRobots', () => {
  const robots = parseRobots(
    [
      '# comment',
      'User-agent: *',
      'Disallow: /private/',
      'Allow: /private/careers',
      'Disallow: /*.json$',
      'Crawl-delay: 2',
      '',
      'User-agent: OtherBot',
      'Disallow: /',
    ].join('\n'),
    'InterviewForgeBot/0.1',
  );

  test('applies the * group with longest-match precedence', () => {
    assert.equal(robots.isAllowed('/'), true);
    assert.equal(robots.isAllowed('/private/secret'), false);
    assert.equal(robots.isAllowed('/private/careers'), true);
    assert.equal(robots.isAllowed('/data.json'), false);
    assert.equal(robots.isAllowed('/data.json?x=1'), true);
  });

  test('reads Crawl-delay', () => {
    assert.equal(robots.crawlDelayMs, 2000);
  });

  test('uses a group that names our bot over *', () => {
    const specific = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: InterviewForgeBot\nDisallow: /tmp/',
      'InterviewForgeBot/0.1',
    );
    assert.equal(specific.isAllowed('/careers'), true);
    assert.equal(specific.isAllowed('/tmp/x'), false);
  });

  test('an empty file allows everything', () => {
    assert.equal(parseRobots('', 'InterviewForgeBot/0.1').isAllowed('/anything'), true);
  });
});

describe('scoreLink', () => {
  const score = (url, text) => scoreLink({ url, text }).score;

  test('ranks hiring-process pages above careers, careers above about, about above blog posts', () => {
    const howWeHire = score('https://acme.com/company/how-we-hire', 'How we hire');
    const careers = score('https://acme.com/careers', 'Careers');
    const about = score('https://acme.com/about', 'About us');
    const post = score('https://acme.com/blog/2023/05/launch', 'Launch day');
    assert.ok(howWeHire > careers, `${howWeHire} > ${careers}`);
    assert.ok(careers > about, `${careers} > ${about}`);
    assert.ok(about > post, `${about} > ${post}`);
  });

  test('uses anchor text when the path says nothing', () => {
    assert.ok(score('https://acme.com/p/8812', 'Our interview process') > 10);
  });

  test('pushes useless pages below zero', () => {
    assert.ok(score('https://acme.com/privacy', 'Privacy policy') < 0);
    assert.ok(score('https://acme.com/login', 'Log in') < 0);
  });

  test('ignores tracking query strings (seen on about.gitlab.com)', () => {
    const trial =
      'https://gitlab.com/-/trial_registrations/new?glm_content=default-saas-trial&glm_source=about.gitlab.com/jobs';
    assert.ok(score(trial, 'Get free trial') < 0);
  });

  test('"handbook" alone is not enough to call a link a hiring link (seen on posthog.com)', () => {
    assert.equal(
      scoreLink({ url: 'https://posthog.com/handbook/values', text: 'Values' }).kind,
      'about',
    );
    assert.equal(scoreLink({ url: 'https://posthog.com/handbook', text: 'Handbook' }).kind, null);
    assert.equal(
      scoreLink({
        url: 'https://posthog.com/handbook/people/hiring-process',
        text: 'Hiring process',
      }).kind,
      'hiring',
    );
  });

  test('classifies the link', () => {
    assert.equal(scoreLink({ url: 'https://acme.com/jobs', text: 'Jobs' }).kind, 'hiring');
    assert.equal(scoreLink({ url: 'https://acme.com/about', text: 'About' }).kind, 'about');
    assert.equal(scoreLink({ url: 'https://acme.com/x', text: 'Click' }).kind, null);
  });
});

describe('looksLikeHiringProcess', () => {
  test('needs at least two hiring signals', () => {
    assert.ok(
      looksLikeHiringProcess(
        'Our interview process has a take-home and a system design interview.',
      ),
    );
    assert.ok(!looksLikeHiringProcess('We are hiring!'));
  });
});

describe('extract', () => {
  test('extractLinks resolves relative links and honours <base>', () => {
    const html = `<head><base href="https://acme.com/en/"></head>
      <a href="careers">Careers</a><a href="../about#team">About</a>
      <a href="mailto:hi@acme.com">Mail</a><a href="/files/deck.pdf">Deck</a>`;
    const links = extractLinks(html, 'https://acme.com/other/page');
    assert.deepEqual(
      links.map((l) => l.url),
      ['https://acme.com/en/careers', 'https://acme.com/about'],
    );
  });

  test('extractLinks strips tracking parameters so duplicates collapse', () => {
    const links = extractLinks(
      '<a href="/jobs?utm_source=x">Jobs</a><a href="/jobs?glm_source=y&team=eng">Eng jobs</a>',
      'https://a.com/',
    );
    assert.deepEqual(
      links.map((l) => l.url),
      ['https://a.com/jobs', 'https://a.com/jobs?team=eng'],
    );
  });

  test('extractLinks keeps the most descriptive text for a repeated URL', () => {
    const links = extractLinks(
      '<a href="/jobs">Jobs</a><a href="/jobs">See open jobs</a>',
      'https://a.com/',
    );
    assert.equal(links[0].text, 'See open jobs');
  });

  test('extractPageContent keeps paragraphs and drops chrome', () => {
    const content = extractPageContent(
      `<title>Acme</title><meta name="description" content="Rockets">
       <body><nav>Menu</nav><script>evil()</script>
       <main><h1>Hello</h1><p>First para.</p><p>Second para.</p></main>
       <footer>© Acme</footer></body>`,
    );
    assert.equal(content.title, 'Acme');
    assert.equal(content.description, 'Rockets');
    assert.equal(content.text, 'Hello\nFirst para.\nSecond para.');
  });

  test('extractPageContent truncates very long pages', () => {
    const content = extractPageContent(`<p>${'word '.repeat(1000)}</p>`, { maxChars: 100 });
    assert.equal(content.text.length, 100);
    assert.equal(content.truncated, true);
  });
});
