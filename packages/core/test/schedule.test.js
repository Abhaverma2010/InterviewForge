import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchedule,
  questionCost,
  sortForSchedule,
  splitIntoDays,
} from '../src/scheduling/schedule.js';

const requirements = [
  { id: 'r1', priority: 'must' },
  { id: 'r2', priority: 'must' },
  { id: 'r3', priority: 'nice' },
];
const requirementsById = new Map(requirements.map((r) => [r.id, r]));

const questions = [
  { id: 'q1', requirement_ids: ['r3'], category: 'technical', difficulty: 3 },
  { id: 'q2', requirement_ids: ['r1'], category: 'technical', difficulty: 1 },
  { id: 'q3', requirement_ids: ['r2'], category: 'behavioural', difficulty: 2 },
  { id: 'q4', requirement_ids: ['r1'], category: 'system-design', difficulty: 3 },
  { id: 'q5', requirement_ids: ['r3'], category: 'company-fit', difficulty: 1 },
  { id: 'q6', requirement_ids: ['r1', 'r3'], category: 'technical', difficulty: 2 },
];

describe('questionCost', () => {
  test('is 10 minutes plus 10 per difficulty level', () => {
    assert.equal(questionCost({ difficulty: 1 }), 20);
    assert.equal(questionCost({ difficulty: 2 }), 30);
    assert.equal(questionCost({ difficulty: 3 }), 40);
  });
});

describe('sortForSchedule', () => {
  test('puts must-have questions first, hardest first within each group', () => {
    const ids = sortForSchedule(questions, requirementsById).map((q) => q.id);
    // must: q4 (3), q3 (2), q6 (2), q2 (1)   nice: q1 (3), q5 (1)
    assert.deepEqual(ids, ['q4', 'q3', 'q6', 'q2', 'q1', 'q5']);
  });

  test('does not modify the array it was given', () => {
    const before = questions.map((q) => q.id);
    sortForSchedule(questions, requirementsById);
    assert.deepEqual(
      questions.map((q) => q.id),
      before,
    );
  });
});

describe('splitIntoDays', () => {
  const sizes = (groups) => groups.map((g) => g.length);

  test('front-loads the extra items', () => {
    assert.deepEqual(sizes(splitIntoDays([1, 2, 3, 4, 5, 6, 7], 3)), [3, 2, 2]);
  });

  test('keeps items in order', () => {
    assert.deepEqual(splitIntoDays([1, 2, 3, 4, 5], 2), [
      [1, 2, 3],
      [4, 5],
    ]);
  });

  test('leaves trailing days empty when there are more days than items', () => {
    assert.deepEqual(sizes(splitIntoDays(['a', 'b'], 4)), [1, 1, 0, 0]);
  });

  test('handles no items', () => {
    assert.deepEqual(splitIntoDays([], 2), [[], []]);
  });
});

describe('buildSchedule', () => {
  const allIds = (schedule) => new Set(schedule.days.flatMap((d) => d.question_ids));

  for (const days of [1, 2, 3, 5, 60]) {
    test(`${days}-day schedule has exactly ${days} well-formed days`, () => {
      const schedule = buildSchedule({ requirements, questions, days });
      assert.equal(schedule.days_available, days);
      assert.equal(schedule.days.length, days);
      schedule.days.forEach((d, i) => {
        assert.equal(d.day, i + 1);
        assert.ok(Number.isInteger(d.minutes) && d.minutes > 0, `day ${d.day} minutes`);
        assert.equal(typeof d.focus, 'string');
        assert.ok(d.focus.length > 0);
      });
    });

    test(`${days}-day schedule includes every question, and only real ones`, () => {
      const schedule = buildSchedule({ requirements, questions, days });
      const ids = allIds(schedule);
      for (const q of questions) assert.ok(ids.has(q.id), `${q.id} missing`);
      const known = new Set(questions.map((q) => q.id));
      for (const id of ids) assert.ok(known.has(id), `${id} is not a question`);
    });
  }

  test('every must-have requirement appears somewhere', () => {
    const schedule = buildSchedule({ requirements, questions, days: 5 });
    const scheduled = allIds(schedule);
    const covered = new Set(
      questions.filter((q) => scheduled.has(q.id)).flatMap((q) => q.requirement_ids),
    );
    for (const r of requirements.filter((r) => r.priority === 'must')) {
      assert.ok(covered.has(r.id), `${r.id} missing from schedule`);
    }
  });

  test('must-have material is scheduled before nice-to-have material', () => {
    const schedule = buildSchedule({ requirements, questions, days: 4 });
    const firstDay = new Map();
    for (const d of schedule.days) {
      for (const id of d.question_ids) if (!firstDay.has(id)) firstDay.set(id, d.day);
    }
    const lastMust = Math.max(...['q2', 'q3', 'q4', 'q6'].map((id) => firstDay.get(id)));
    const firstNice = Math.min(...['q1', 'q5'].map((id) => firstDay.get(id)));
    assert.ok(lastMust <= firstNice);
  });

  test('keeps the last day for review when there are 3 or more days', () => {
    const schedule = buildSchedule({ requirements, questions, days: 3 });
    assert.match(schedule.days.at(-1).focus, /^Review/);
  });

  test('a 1-day schedule puts everything on day 1', () => {
    const schedule = buildSchedule({ requirements, questions, days: 1 });
    assert.equal(schedule.days[0].question_ids.length, questions.length);
  });

  test('still returns the requested days when there are no questions', () => {
    const schedule = buildSchedule({ requirements: [], questions: [], days: 3 });
    assert.equal(schedule.days.length, 3);
  });

  test('rejects a days value that is not a positive integer', () => {
    for (const days of [0, -1, 2.5, '5', undefined]) {
      assert.throws(() => buildSchedule({ requirements, questions, days }), RangeError);
    }
  });
});
