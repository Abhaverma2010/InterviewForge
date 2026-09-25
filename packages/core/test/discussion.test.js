import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCompanyName } from '../src/retrieval/company-name.js';
import { excerptAround, searchPublicDiscussion } from '../src/retrieval/discussion.js';
import { FetchError } from '../src/retrieval/errors.js';

const fakeFetcher = (respond) => {
  const urls = [];
  return {
    urls,
    async fetchText(url) {
      urls.push(String(url));
      return respond(url);
    },
  };
};

const hits = (items) => ({ body: JSON.stringify({ hits: items }) });

describe('searchPublicDiscussion', () => {
  test('keeps hits that name the company and talk about hiring', async () => {
    const fetcher = fakeFetcher(() =>
      hits([
        {
          objectID: '1',
          story_title: 'Ask HN: Interviewing at PostHog?',
          comment_text:
            'I did the <i>PostHog</i> interview: a paid SuperDay after a technical interview.',
          created_at: '2025-03-01T00:00:00Z',
        },
        { objectID: '2', title: 'PostHog raises Series D', story_text: 'Funding news.' },
        { objectID: '3', title: 'How we hire at Stripe', story_text: 'Our interview loop...' },
        {
          objectID: '1',
          story_title: 'duplicate',
          comment_text: 'PostHog interview again',
        },
      ]),
    );
    const result = await searchPublicDiscussion('PostHog', { fetcher });
    assert.equal(result.error, null);
    assert.deepEqual(
      result.results.map((r) => r.url),
      ['https://news.ycombinator.com/item?id=1'],
    );
    assert.match(result.results[0].excerpt, /paid SuperDay/);
    assert.doesNotMatch(result.results[0].excerpt, /<i>/);
    assert.match(fetcher.urls[0], /hn\.algolia\.com.*query=PostHog\+interview/);
  });

  test('ignores "user interviews" and ranks hiring experiences first (seen for PostHog)', async () => {
    const fetcher = fakeFetcher(() =>
      hits([
        {
          objectID: '10',
          story_title: 'Making PostHog insights quicker with LLMs?',
          comment_text: 'We run user interviews and PostHog to understand cohorts.',
        },
        {
          objectID: '11',
          story_title: 'Things we have learned',
          comment_text: 'I interviewed at PostHog. The SuperDay is a paid trial day.',
        },
        {
          objectID: '12',
          story_title: 'Things we have learned',
          comment_text:
            'PostHog interview process: recruiter call, technical interview, then a SuperDay.',
        },
      ]),
    );
    const result = await searchPublicDiscussion('PostHog', { fetcher });
    assert.deepEqual(
      result.results.map((r) => r.url.split('=')[1]),
      ['12', '11'],
    );
  });

  test('finding nothing is a normal, empty result', async () => {
    const result = await searchPublicDiscussion('Obscure Co', {
      fetcher: fakeFetcher(() => hits([])),
    });
    assert.deepEqual(result.results, []);
    assert.equal(result.error, null);
  });

  test('an unreachable API is recorded, not thrown', async () => {
    const fetcher = fakeFetcher(() => {
      throw new FetchError('TIMEOUT', 'Timed out');
    });
    const result = await searchPublicDiscussion('Acme', { fetcher });
    assert.deepEqual(result.results, []);
    assert.equal(result.error.code, 'TIMEOUT');
  });

  test('invalid JSON is recorded, not thrown', async () => {
    const result = await searchPublicDiscussion('Acme', {
      fetcher: fakeFetcher(() => ({ body: '<html>' })),
    });
    assert.equal(result.error.code, 'BAD_RESPONSE');
  });

  test('respects maxResults', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      objectID: String(i),
      title: `Acme interview process story ${i}`,
    }));
    const result = await searchPublicDiscussion(
      'Acme',
      { fetcher: fakeFetcher(() => hits(many)) },
      { maxResults: 3 },
    );
    assert.equal(result.results.length, 3);
  });
});

describe('excerptAround', () => {
  test('centres long text on the first match', () => {
    const text = `${'a '.repeat(500)}the interview was hard ${'b '.repeat(500)}`;
    const excerpt = excerptAround(text, /interview/, 100);
    assert.match(excerpt, /interview/);
    assert.ok(excerpt.length <= 102);
  });
});

describe('guessCompanyName', () => {
  test('prefers the name from the job description', () => {
    assert.equal(
      guessCompanyName({ fromJd: 'Acme Corp', siteName: 'Acme', url: 'https://acme.com' }),
      'Acme Corp',
    );
  });
  test('then og:site_name, then the title', () => {
    assert.equal(
      guessCompanyName({ siteName: 'PostHog', title: 'x', url: 'https://posthog.com' }),
      'PostHog',
    );
    assert.equal(
      guessCompanyName({
        title: 'PostHog – How developers build products',
        url: 'https://posthog.com',
      }),
      'PostHog',
    );
  });
  test('falls back to the domain, or the path on localhost', () => {
    assert.equal(
      guessCompanyName({ title: 'Home', url: 'https://www.about.gitlab.com/' }),
      'Gitlab',
    );
    assert.equal(guessCompanyName({ url: 'http://localhost:8099/acme/' }), 'Acme');
  });
});
