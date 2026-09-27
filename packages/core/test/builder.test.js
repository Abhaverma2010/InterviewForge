import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdits,
  BuilderError,
  isReplaceable,
  regenerateCategory,
  regenerateSchedule,
} from '../src/builder/builder.js';
import { validateKit } from '../src/validation/kit-schema.js';
import { createFakeLlm } from './helpers/fake-llm.js';

function makeKit() {
  const question = (id, category, requirement_ids, extra = {}) => ({
    id,
    requirement_ids,
    category,
    prompt: `Question ${id}?`,
    answer_outline: '- a',
    difficulty: 2,
    origin: 'generated',
    edited: false,
    pinned: false,
    ...extra,
  });
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.test/',
      role: 'Engineer',
      location: 'Remote',
      jd_chars: 300,
      researched_at: '2026-09-01T00:00:00.000Z',
      pages_used: [],
    },
    company_brief: {
      summary: 'Acme builds rockets.',
      what_they_do: 'Launches.',
      sources: [],
      found: true,
      hiring_process: { found: false, stages: [], notes: [], sources: [] },
    },
    role: {
      title: 'Engineer',
      seniority: 'mid',
      responsibilities: [],
      requirements: [
        { id: 'r1', text: 'Go', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'SQL', kind: 'technical', priority: 'must' },
        { id: 'r3', text: 'Communication', kind: 'behavioural', priority: 'must' },
      ],
    },
    questions: [
      question('q1', 'technical', ['r1']),
      question('q2', 'technical', ['r2']),
      question('q3', 'behavioural', ['r3']),
      question('q4', 'company-fit', []),
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'Go?',
        back: 'Yes.',
        requirement_ids: ['r1'],
        origin: 'generated',
        edited: false,
        pinned: false,
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Technical', question_ids: ['q1', 'q2'], minutes: 60 },
        { day: 2, focus: 'Other', question_ids: ['q3', 'q4'], minutes: 50 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

let kit;
beforeEach(() => {
  kit = makeKit();
});

describe('applyEdits', () => {
  test('marks a changed question as edited, decided by comparison', () => {
    const questions = structuredClone(kit.questions);
    questions[0].prompt = 'My better question?';
    questions[1].edited = true; // a client cannot set this on an unchanged item...
    const next = applyEdits(kit, { questions });
    assert.equal(next.questions[0].edited, true);
    assert.equal(next.questions[1].edited, false);
  });

  test('a client cannot clear edited once set', () => {
    const questions = structuredClone(kit.questions);
    questions[0].prompt = 'Changed?';
    const once = applyEdits(kit, { questions });
    const resent = structuredClone(once.questions).map((q) => ({ ...q, edited: false }));
    assert.equal(applyEdits(once, { questions: resent }).questions[0].edited, true);
  });

  test('reorders by the order sent, without marking anything edited', () => {
    const next = applyEdits(kit, { questions: [...kit.questions].reverse() });
    assert.deepEqual(
      next.questions.map((q) => q.id),
      ['q4', 'q3', 'q2', 'q1'],
    );
    assert.ok(next.questions.every((q) => !q.edited));
  });

  test('moving a question to another category counts as an edit', () => {
    const questions = structuredClone(kit.questions);
    questions[1].category = 'system-design';
    const moved = applyEdits(kit, { questions }).questions[1];
    assert.equal(moved.category, 'system-design');
    assert.equal(moved.edited, true);
  });

  test('gives a new question the next id and marks it as the user’s', () => {
    const next = applyEdits(kit, {
      questions: [
        ...kit.questions,
        {
          id: 'tmp-123',
          category: 'technical',
          requirement_ids: ['r1', 'r99'],
          prompt: ' Mine? ',
          answer_outline: '',
          difficulty: 3,
        },
      ],
    });
    const mine = next.questions.at(-1);
    assert.deepEqual(
      {
        id: mine.id,
        origin: mine.origin,
        prompt: mine.prompt,
        requirement_ids: mine.requirement_ids,
      },
      { id: 'q5', origin: 'user', prompt: 'Mine?', requirement_ids: ['r1'] },
    );
  });

  test('deleting a question removes it from the schedule and updates coverage', () => {
    const next = applyEdits(kit, { questions: kit.questions.filter((q) => q.id !== 'q2') });
    assert.deepEqual(next.schedule.days[0].question_ids, ['q1']);
    assert.deepEqual(next.coverage.uncovered_requirement_ids, ['r2']);
    assert.deepEqual(validateKit(next), { ok: true });
  });

  test('pinning is taken as sent', () => {
    const questions = structuredClone(kit.questions);
    questions[2].pinned = true;
    assert.equal(applyEdits(kit, { questions }).questions[2].pinned, true);
  });

  test('edits flashcards and the brief the same way', () => {
    const next = applyEdits(kit, {
      flashcards: [
        { ...kit.flashcards[0], back: 'Definitely.' },
        { front: 'New card', back: 'Back' },
      ],
      company_brief: { summary: 'Acme builds very good rockets.' },
    });
    assert.equal(next.flashcards[0].edited, true);
    assert.equal(next.flashcards[1].id, 'f2');
    assert.equal(next.flashcards[1].origin, 'user');
    assert.equal(next.company_brief.edited, true);
    assert.equal(next.company_brief.what_they_do, 'Launches.');
  });

  test('rejects edits that break the kit', () => {
    const questions = structuredClone(kit.questions);
    questions[0].difficulty = 9;
    assert.throws(() => applyEdits(kit, { questions }), BuilderError);
  });
});

describe('regenerateCategory', () => {
  test('replaces untouched questions and keeps edited, pinned and user-written ones', async () => {
    const questions = structuredClone(kit.questions);
    questions[0].prompt = 'Edited by me?'; // q1 edited
    questions.push({
      id: 'new',
      category: 'technical',
      requirement_ids: ['r2'],
      prompt: 'Written by me?',
      answer_outline: '',
      difficulty: 1,
    });
    let edited = applyEdits(kit, { questions });
    edited = applyEdits(edited, {
      questions: edited.questions.map((q) => (q.id === 'q3' ? { ...q, pinned: true } : q)),
    });

    const next = await regenerateCategory(edited, 'technical', { llm: createFakeLlm() });
    const ids = next.questions.map((q) => q.id);

    assert.ok(ids.includes('q1'), 'edited question kept');
    assert.equal(next.questions.find((q) => q.id === 'q1').prompt, 'Edited by me?');
    assert.ok(ids.includes('q5'), 'user question kept');
    assert.ok(!ids.includes('q2'), 'untouched generated question replaced');
    assert.ok(ids.includes('q3') && ids.includes('q4'), 'other categories untouched');
    const fresh = next.questions.filter((q) => Number(q.id.slice(1)) > 5);
    assert.ok(
      fresh.length > 0 &&
        fresh.every((q) => q.category === 'technical' && q.origin === 'generated'),
    );
    assert.deepEqual(validateKit(next), { ok: true });
  });

  test('does not leave a must-have uncovered', async () => {
    // The fake's first technical draft cites only the first requirement.
    const next = await regenerateCategory(kit, 'technical', { llm: createFakeLlm() });
    assert.deepEqual(next.coverage.uncovered_requirement_ids, []);
  });

  test('drops replaced questions from the schedule', async () => {
    const next = await regenerateCategory(kit, 'technical', { llm: createFakeLlm() });
    const ids = new Set(next.questions.map((q) => q.id));
    for (const day of next.schedule.days) for (const id of day.question_ids) assert.ok(ids.has(id));
  });

  test('rejects an unknown category', async () => {
    await assert.rejects(regenerateCategory(kit, 'trivia', { llm: createFakeLlm() }), {
      code: 'INVALID_CATEGORY',
    });
  });
});

describe('regenerateSchedule', () => {
  test('schedules every current question over the same number of days', () => {
    const withNew = applyEdits(kit, {
      questions: [
        ...kit.questions,
        {
          id: 'x',
          category: 'technical',
          requirement_ids: ['r1'],
          prompt: 'Extra?',
          answer_outline: '',
          difficulty: 1,
        },
      ],
    });
    const next = regenerateSchedule(withNew);
    assert.equal(next.schedule.days.length, 2);
    const scheduled = new Set(next.schedule.days.flatMap((d) => d.question_ids));
    for (const q of next.questions) assert.ok(scheduled.has(q.id));
  });
});

describe('isReplaceable', () => {
  test('only untouched generated items are replaceable', () => {
    assert.equal(isReplaceable({ origin: 'generated', edited: false, pinned: false }), true);
    assert.equal(isReplaceable({ origin: 'template', edited: false, pinned: false }), true);
    assert.equal(isReplaceable({ origin: 'user', edited: false, pinned: false }), false);
    assert.equal(isReplaceable({ origin: 'generated', edited: true, pinned: false }), false);
    assert.equal(isReplaceable({ origin: 'generated', edited: false, pinned: true }), false);
  });
});
