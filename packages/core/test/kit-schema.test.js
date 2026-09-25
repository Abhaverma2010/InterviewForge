import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCoverageGaps } from '../src/coverage/coverage.js';
import { validateKit } from '../src/validation/kit-schema.js';

// The example from Appendix A, filled in.
function exampleKit() {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.com',
      role: 'Backend Engineer',
      location: 'Remote',
      jd_chars: 1200,
      researched_at: '2026-09-01T09:12:44Z',
      pages_used: ['https://acme.com/careers'],
    },
    company_brief: { summary: 's', what_they_do: 'w', sources: ['https://acme.com'] },
    role: {
      title: 'Backend Engineer',
      seniority: 'senior',
      responsibilities: ['Build APIs'],
      requirements: [
        { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring', kind: 'behavioural', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'p',
        answer_outline: 'a',
        difficulty: 2,
      },
    ],
    flashcards: [{ id: 'f1', front: 'f', back: 'b', requirement_ids: ['r1'] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'React', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Review', question_ids: [], minutes: 30 },
      ],
    },
    coverage: { uncovered_requirement_ids: ['r2'], passes: 2 },
  };
}

describe('validateKit', () => {
  test('accepts the Appendix A structure', () => {
    assert.deepEqual(validateKit(exampleKit()), { ok: true });
  });

  test('allows extension fields', () => {
    const kit = exampleKit();
    kit.questions[0].pinned = true;
    kit.meta = { anything: 1 };
    assert.deepEqual(validateKit(kit), { ok: true });
  });

  const broken = [
    ['a missing field', (k) => delete k.coverage.passes, /coverage.passes/],
    ['float minutes', (k) => (k.schedule.days[0].minutes = 59.5), /minutes/],
    ['difficulty out of range', (k) => (k.questions[0].difficulty = 4), /difficulty/],
    ['an unknown kind', (k) => (k.role.requirements[0].kind = 'soft'), /kind/],
    ['an unknown category', (k) => (k.questions[0].category = 'trivia'), /category/],
    ['a malformed id', (k) => (k.questions[0].id = 'question-1'), /id/],
    ['a schedule of the wrong length', (k) => k.schedule.days.pop(), /days_available/],
    [
      'a schedule pointing at a missing question',
      (k) => (k.schedule.days[0].question_ids = ['q9']),
      /unknown q9/,
    ],
    [
      'a question citing a missing requirement',
      (k) => (k.questions[0].requirement_ids = ['r7']),
      /unknown r7/,
    ],
    ['duplicate ids', (k) => k.questions.push({ ...k.questions[0] }), /duplicate question id q1/],
    ['misnumbered days', (k) => (k.schedule.days[1].day = 3), /numbered 3/],
    ['a non-ISO date', (k) => (k.source.researched_at = 'yesterday'), /researched_at/],
  ];
  for (const [name, mutate, pattern] of broken) {
    test(`rejects ${name}`, () => {
      const kit = exampleKit();
      mutate(kit);
      const result = validateKit(kit);
      assert.equal(result.ok, false);
      assert.ok(
        result.errors.some((e) => pattern.test(e)),
        `expected an error matching ${pattern}, got ${JSON.stringify(result.errors)}`,
      );
    });
  }
});

describe('findCoverageGaps', () => {
  const requirements = [
    { id: 'r1', priority: 'must' },
    { id: 'r2', priority: 'must' },
    { id: 'r3', priority: 'nice' },
  ];

  test('lists requirements no question cites, split by priority', () => {
    const gaps = findCoverageGaps(requirements, [{ requirement_ids: ['r1'] }]);
    assert.deepEqual(gaps, {
      uncovered: ['r2', 'r3'],
      uncoveredMust: ['r2'],
      uncoveredNice: ['r3'],
    });
  });

  test('a question citing several requirements covers them all', () => {
    const gaps = findCoverageGaps(requirements, [{ requirement_ids: ['r1', 'r2', 'r3'] }]);
    assert.deepEqual(gaps.uncovered, []);
  });

  test('no questions means everything is uncovered', () => {
    assert.deepEqual(findCoverageGaps(requirements, []).uncoveredMust, ['r1', 'r2']);
  });
});
