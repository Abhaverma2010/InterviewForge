import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, regenerateCategory, replanFromToday } from '../src/builder/builder.js';
import { currentDay, daysLeft, readiness, replanSchedule } from '../src/scheduling/adaptive.js';
import { analyseStoryBank, isStoryQuestion } from '../src/stories/story-bank.js';
import { validateKit } from '../src/validation/kit-schema.js';
import { createFakeLlm } from './helpers/fake-llm.js';

function makeKit() {
  const question = (id, category, requirement_ids, prompt = `Question ${id}?`, difficulty = 2) => ({
    id,
    requirement_ids,
    category,
    prompt,
    answer_outline: '- a',
    difficulty,
    origin: 'generated',
    edited: false,
    pinned: false,
  });
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.test/',
      role: 'Engineer',
      location: 'Remote',
      jd_chars: 300,
      researched_at: '2026-09-20T10:00:00.000Z',
      pages_used: [],
    },
    company_brief: { summary: 's', what_they_do: 'w', sources: [], found: true },
    role: {
      title: 'Engineer',
      seniority: 'mid',
      responsibilities: [],
      requirements: [
        { id: 'r1', text: 'Go', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'SQL', kind: 'technical', priority: 'must' },
        { id: 'r3', text: 'Mentoring', kind: 'behavioural', priority: 'must' },
        { id: 'r4', text: 'Communication', kind: 'behavioural', priority: 'must' },
        { id: 'r5', text: 'Kafka', kind: 'technical', priority: 'nice' },
      ],
    },
    questions: [
      question('q1', 'technical', ['r1'], 'Explain goroutines.', 3),
      question('q2', 'technical', ['r2'], 'Explain indexes.', 1),
      question('q3', 'behavioural', ['r3'], 'Tell me about a time you mentored someone.'),
      question(
        'q4',
        'behavioural',
        ['r4'],
        'Tell me about a time you explained something complex.',
      ),
      question('q5', 'company-fit', [], 'Why Acme?'),
      question('q6', 'technical', ['r5'], 'Tell me about a time you debugged a Kafka consumer.'),
      question('q7', 'technical', ['r5'], 'What is a consumer group?', 1),
    ],
    flashcards: [
      { id: 'f1', front: 'Go?', back: 'Yes', requirement_ids: ['r1'] },
      { id: 'f2', front: 'SQL?', back: 'Yes', requirement_ids: ['r2'] },
      { id: 'f3', front: 'Kafka?', back: 'Yes', requirement_ids: ['r5'] },
    ],
    schedule: {
      days_available: 5,
      start_date: '2026-09-20',
      days: [1, 2, 3, 4, 5].map((day) => ({
        day,
        focus: 'x',
        question_ids: day === 1 ? ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] : [],
        minutes: 30,
      })),
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

const story = (id, title, requirement_ids = [], question_ids = []) => ({
  id,
  title,
  situation: 'S',
  action: 'A',
  result: 'R',
  requirement_ids,
  question_ids,
});

// ─── Story bank ──────────────────────────────────────────────────────────────

describe('story bank: editing', () => {
  test('adds stories with ids, and keeps a link to a question created in the same save', () => {
    const kit = makeKit();
    const next = applyEdits(kit, {
      questions: [
        ...kit.questions,
        {
          id: 'tmp-q-1',
          category: 'behavioural',
          requirement_ids: [],
          prompt: 'Tell me about a failure.',
          answer_outline: '',
          difficulty: 2,
        },
      ],
      stories: [
        {
          id: 'tmp-s-1',
          title: 'The outage',
          situation: 'x',
          action: 'y',
          result: 'z',
          requirement_ids: ['r3', 'r99'],
          question_ids: ['tmp-q-1'],
        },
      ],
    });
    assert.equal(next.stories[0].id, 's1');
    assert.deepEqual(next.stories[0].requirement_ids, ['r3']);
    assert.deepEqual(next.stories[0].question_ids, ['q8']);
    assert.deepEqual(validateKit(next), { ok: true });
  });

  test('deleting a question removes it from stories', () => {
    const kit = applyEdits(makeKit(), { stories: [story('tmp', 'Outage', [], ['q3', 'q4'])] });
    const next = applyEdits(kit, { questions: kit.questions.filter((q) => q.id !== 'q3') });
    assert.deepEqual(next.stories[0].question_ids, ['q4']);
  });

  test('regenerating a category drops links to replaced questions', async () => {
    const kit = applyEdits(makeKit(), { stories: [story('tmp', 'Outage', [], ['q1'])] });
    const next = await regenerateCategory(kit, 'technical', { llm: createFakeLlm() });
    assert.deepEqual(next.stories[0].question_ids, []);
    assert.deepEqual(validateKit(next), { ok: true });
  });

  test('validation rejects a story pointing at a missing question', () => {
    const kit = { ...makeKit(), stories: [story('s1', 'X', [], ['q99'])] };
    assert.equal(validateKit(kit).ok, false);
  });
});

describe('story bank: analysis', () => {
  test('matches stories by shared requirement and by direct link', () => {
    const kit = {
      ...makeKit(),
      stories: [story('s1', 'Mentoring Sam', ['r3']), story('s2', 'Why I left', [], ['q5'])],
    };
    const result = analyseStoryBank(kit);
    const byQ = Object.fromEntries(result.questions.map((q) => [q.question_id, q]));
    assert.deepEqual(byQ.q3.story_ids, ['s1']);
    assert.equal(byQ.q3.via.s1, 'requirement');
    assert.deepEqual(byQ.q5.story_ids, ['s2']);
    assert.equal(byQ.q5.via.s2, 'linked');
  });

  test('reports questions without a story and behavioural requirements no story shows', () => {
    const kit = { ...makeKit(), stories: [story('s1', 'Mentoring Sam', ['r3'])] };
    const result = analyseStoryBank(kit);
    // q4 (communication), q5 (company fit) and q6 (a technical story question) have none.
    assert.deepEqual(result.unanswered, ['q4', 'q5', 'q6']);
    assert.deepEqual(result.requirementsWithoutStory, ['r4']);
    assert.equal(result.covered, 1);
    assert.equal(result.total, 4);
  });

  test('flags a story used for four or more questions, and unused stories', () => {
    const kit = {
      ...makeKit(),
      stories: [story('s1', 'The big one', ['r3', 'r4', 'r5'], ['q5']), story('s2', 'Spare')],
    };
    const result = analyseStoryBank(kit);
    assert.deepEqual(result.overused, [{ story_id: 's1', count: 4 }]);
    assert.deepEqual(result.unused, ['s2']);
  });

  test('story questions are behavioural, company fit, or phrased as a story', () => {
    const kit = makeKit();
    assert.deepEqual(
      kit.questions.filter(isStoryQuestion).map((q) => q.id),
      ['q3', 'q4', 'q5', 'q6'],
    );
  });

  test('a kit without stories is analysed as empty', () => {
    const result = analyseStoryBank(makeKit());
    assert.equal(result.covered, 0);
    assert.deepEqual(result.requirementsWithoutStory, ['r3', 'r4']);
  });
});

// ─── Adaptive plan ───────────────────────────────────────────────────────────

describe('readiness', () => {
  test('scores from practice boxes, weighting must-haves double', () => {
    const kit = makeKit();
    const r = readiness(kit, { f1: { box: 5 }, f2: { box: 1 } });
    const byId = Object.fromEntries(r.requirements.map((x) => [x.id, x]));
    assert.equal(byId.r1.confidence, 1);
    assert.equal(byId.r2.confidence, 0.2);
    assert.equal(byId.r5.confidence, 0); // card not reviewed yet
    assert.equal(byId.r3.confidence, null); // no card measures it
    // (1*2 + 0.2*2 + 0 + 0 + 0*1) / (2+2+2+2+1) = 2.4 / 9
    assert.equal(r.score, 27);
    assert.deepEqual(r.shaky_must, ['r3', 'r4', 'r2']);
  });

  test('nothing practised means 0', () => {
    assert.equal(readiness(makeKit()).score, 0);
  });
});

describe('current day and days left', () => {
  const kit = makeKit(); // 5 days from 2026-09-20
  test('counts from the plan’s start date', () => {
    assert.equal(currentDay(kit, new Date('2026-09-20T23:00:00Z')), 1);
    assert.equal(currentDay(kit, new Date('2026-09-22T08:00:00Z')), 3);
    assert.equal(daysLeft(kit, new Date('2026-09-22T08:00:00Z')), 3);
  });
  test('never fewer than one day left', () => {
    assert.equal(daysLeft(kit, new Date('2026-10-30T08:00:00Z')), 1);
  });
});

describe('replan from today', () => {
  const today = new Date('2026-09-22T08:00:00Z'); // day 3 of 5

  test('plans only the days left, starting today', () => {
    const schedule = replanSchedule(makeKit(), {}, { today });
    assert.equal(schedule.days_available, 3);
    assert.equal(schedule.days.length, 3);
    assert.equal(schedule.start_date, '2026-09-22');
  });

  test('puts the weakest must-have first, whatever its difficulty', () => {
    // Go (r1) is solid, SQL (r2) is shaky; q1 (Go) is the harder question.
    const cards = { f1: { box: 5 }, f2: { box: 1 } };
    const schedule = replanSchedule(makeKit(), cards, { today, days: 7 });
    const order = schedule.days.flatMap((d) => d.question_ids);
    assert.ok(order.indexOf('q2') < order.indexOf('q1'), `order was ${order}`);
    assert.deepEqual(schedule.adaptive.prioritised.slice(0, 1), ['r3']);
  });

  test('still schedules every question and passes validation', () => {
    const next = replanFromToday(makeKit(), { f1: { box: 5 } }, { today });
    const scheduled = new Set(next.schedule.days.flatMap((d) => d.question_ids));
    for (const q of next.questions) assert.ok(scheduled.has(q.id));
    assert.deepEqual(validateKit(next), { ok: true });
  });
});
