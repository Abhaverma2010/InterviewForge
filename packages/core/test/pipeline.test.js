import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCoverageGaps } from '../src/coverage/coverage.js';
import { createCrawlerDeps } from '../src/retrieval/index.js';
import {
  needsSystemDesign,
  PipelineError,
  runPipeline,
  validatePipelineInput,
} from '../src/pipeline/run-pipeline.js';
import { validateKit } from '../src/validation/kit-schema.js';
import { createFakeLlm } from './helpers/fake-llm.js';
import { page, startSite } from './helpers/site-server.js';

const JD = `Senior Backend Engineer

What you'll do
- Design and run our payment APIs

Requirements
- 5+ years with Go
- Strong PostgreSQL skills
- Experience with Kafka
- Clear written communication

Nice to have
- Kubernetes experience`;

let site;
before(async () => {
  site = await startSite({
    '/acme/': page(
      'Acme',
      '<main><p>Acme builds reusable rockets for satellite companies.</p><a href="careers/">Careers</a><a href="about/">About us</a></main>',
    ),
    '/acme/about/': page(
      'About Acme',
      '<main><p>Founded in 2019 in Berlin to make launches cheap for everyone.</p></main>',
    ),
    '/acme/careers/': page(
      'Careers',
      '<main><p>Our interview process: a take-home exercise, then a system design interview.</p></main>',
    ),
  });
});
after(() => site.close());

// Offline HN search: the crawler deps with a fetcher that answers the API.
function crawlerDeps() {
  const deps = createCrawlerDeps({
    allowPrivate: true,
    minIntervalMs: 0,
    retries: 0,
    timeoutMs: 2000,
  });
  const realFetch = deps.fetcher.fetchText;
  deps.fetcher.fetchText = (url, opts) =>
    String(url).startsWith('https://hn.algolia.com/')
      ? Promise.resolve({ body: JSON.stringify({ hits: [] }) })
      : realFetch(url, opts);
  return deps;
}

const run = (input, llm, extra = {}) =>
  runPipeline(
    { jd: JD, companyUrl: `${site.origin}/acme/`, days: 5, ...input },
    {
      llm,
      crawler: crawlerDeps(),
      now: () => new Date('2026-09-01T09:00:00Z'),
      ...extra,
    },
  );

describe('runPipeline, full run', () => {
  let kit;
  let llm;
  before(async () => {
    llm = createFakeLlm();
    kit = await run({}, llm);
  });

  test('produces a kit that passes Appendix A validation', () => {
    assert.deepEqual(validateKit(kit), { ok: true });
  });

  test('extracts requirements with priorities from the posting', () => {
    const byText = Object.fromEntries(kit.role.requirements.map((r) => [r.text, r]));
    assert.equal(byText['Kubernetes experience'].priority, 'nice');
    assert.equal(byText['Strong PostgreSQL skills'].priority, 'must');
    assert.equal(byText['Clear written communication'].kind, 'behavioural');
  });

  test('the second pass closes the gaps the first draft left', () => {
    // The fake's first technical draft covers only r1, so pass 1 finds gaps.
    assert.ok(kit.coverage.history[0].uncovered_requirement_ids.length > 0);
    assert.equal(kit.coverage.passes, 2);
    assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
    assert.deepEqual(kit.coverage.template_filled_requirement_ids, []);
    assert.ok(llm.calls.filter((c) => c === 'technical').length >= 2);
  });

  test('generates categories in separate calls, including system design for a senior role', () => {
    for (const category of ['technical', 'behavioural', 'system-design', 'company-fit']) {
      assert.ok(llm.calls.includes(category), `no ${category} call`);
      assert.ok(
        kit.questions.some((q) => q.category === category),
        `no ${category} question`,
      );
    }
  });

  test('uses the crawled hiring page', () => {
    assert.equal(kit.company_brief.hiring_process.found, true);
    assert.equal(kit.company_brief.research.hiring_page, `${site.origin}/acme/careers/`);
    assert.ok(kit.source.pages_used.includes(`${site.origin}/acme/careers/`));
    assert.equal(kit.company_brief.found, true);
  });

  test('fills the source block', () => {
    assert.equal(kit.source.company_url, `${site.origin}/acme/`);
    assert.equal(kit.source.role, 'Senior Backend Engineer');
    assert.equal(kit.source.jd_chars, JD.length);
    assert.equal(kit.source.researched_at, '2026-09-01T09:00:00.000Z');
  });

  test('schedules every question across exactly the requested days', () => {
    assert.equal(kit.schedule.days.length, 5);
    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    for (const q of kit.questions) assert.ok(scheduled.has(q.id));
  });

  test('marks every generated item with builder state', () => {
    for (const item of [...kit.questions, ...kit.flashcards]) {
      assert.equal(item.edited, false);
      assert.equal(item.pinned, false);
      assert.ok(['generated', 'template'].includes(item.origin));
    }
  });
});

describe('runPipeline, when things go wrong', () => {
  test('a model that never fills the gaps still ships no uncovered must-have', async () => {
    const kit = await run({}, createFakeLlm({ gapFillWorks: false }));
    assert.equal(kit.coverage.passes, 3);
    const musts = kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id);
    const { uncoveredMust } = findCoverageGaps(kit.role.requirements, kit.questions);
    assert.deepEqual(uncoveredMust, []);
    assert.ok(kit.coverage.template_filled_requirement_ids.length > 0);
    for (const id of kit.coverage.template_filled_requirement_ids) assert.ok(musts.includes(id));
    assert.ok(kit.questions.some((q) => q.origin === 'template'));
  });

  test('an unreachable company site gives an honest brief without a brief model call', async () => {
    const llm = createFakeLlm();
    const kit = await run({ companyUrl: 'http://127.0.0.1:1/' }, llm);
    assert.deepEqual(validateKit(kit), { ok: true });
    assert.equal(kit.company_brief.found, false);
    assert.match(kit.company_brief.summary, /could not/i);
    assert.deepEqual(kit.company_brief.sources, []);
    assert.ok(!llm.calls.includes('brief'));
    assert.ok(kit.meta.warnings.some((w) => /unreachable/i.test(w)));
  });

  test('an invalid company URL still produces a kit', async () => {
    const kit = await run({ companyUrl: 'not a url' }, createFakeLlm());
    assert.equal(kit.company_brief.research.site_error.code, 'INVALID_URL');
    assert.deepEqual(validateKit(kit), { ok: true });
  });

  test('a two-line posting produces a thin kit that says so', async () => {
    const kit = await run({ jd: 'Frontend developer needed.\nReact.' }, createFakeLlm());
    assert.equal(kit.role.thin, true);
    assert.deepEqual(
      kit.role.requirements.map((r) => r.text),
      ['React'],
    );
    assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
    assert.deepEqual(validateKit(kit), { ok: true });
  });

  test('a failed question category is recorded and covered by the gap pass', async () => {
    const kit = await run({}, createFakeLlm({ failOn: ['behavioural'] }));
    assert.ok(kit.meta.warnings.some((w) => w.startsWith('questions:behavioural failed')));
    const { uncoveredMust } = findCoverageGaps(kit.role.requirements, kit.questions);
    assert.deepEqual(uncoveredMust, []);
  });

  test('if extraction fails there is no kit', async () => {
    await assert.rejects(run({}, createFakeLlm({ failOn: ['extract'] })), (err) => {
      assert.ok(err instanceof PipelineError);
      assert.equal(err.code, 'LLM_UNAVAILABLE');
      return true;
    });
  });

  test('rejects invalid input before doing any work', async () => {
    const llm = createFakeLlm();
    await assert.rejects(run({ days: 0 }, llm), { code: 'INVALID_INPUT' });
    assert.deepEqual(llm.calls, []);
  });

  for (const days of [1, 60]) {
    test(`a ${days}-day request gets a ${days}-day schedule`, async () => {
      const kit = await run({ days }, createFakeLlm());
      assert.equal(kit.schedule.days_available, days);
      assert.equal(kit.schedule.days.length, days);
    });
  }
});

describe('validatePipelineInput', () => {
  test('lists every problem', () => {
    assert.deepEqual(validatePipelineInput({ jd: 'x', companyUrl: 'y', days: 3 }), []);
    assert.equal(validatePipelineInput({ jd: '', companyUrl: '', days: 2.5 }).length, 3);
    assert.equal(validatePipelineInput({ jd: 'x', companyUrl: 'y', days: 400 }).length, 1);
  });
});

describe('needsSystemDesign', () => {
  const role = (over) => ({
    title: 'Engineer',
    seniority: null,
    requirements: [],
    responsibilities: [],
    ...over,
  });
  test('asks for system design for senior roles, a published round, or scale work', () => {
    assert.equal(needsSystemDesign(role({ seniority: 'senior' }), { stages: [] }), true);
    assert.equal(needsSystemDesign(role(), { stages: [{ type: 'system-design' }] }), true);
    assert.equal(
      needsSystemDesign(role({ responsibilities: ['Scale our ingestion pipeline'] }), {
        stages: [],
      }),
      true,
    );
    assert.equal(needsSystemDesign(role(), { stages: [] }), false);
  });
});
