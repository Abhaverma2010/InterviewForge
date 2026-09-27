import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSessionOrder, practiceSummary, rateCard } from '../src/practice/leitner.js';

const at = (day) => new Date(`2026-09-0${day}T10:00:00Z`);

describe('rateCard', () => {
  test('moves cards between boxes 1 and 5', () => {
    assert.equal(rateCard(undefined, 'good').box, 2);
    assert.equal(rateCard(undefined, 'easy').box, 3);
    assert.equal(rateCard({ box: 4, reviews: 3 }, 'again').box, 1);
    assert.equal(rateCard({ box: 3, reviews: 1 }, 'hard').box, 2);
    assert.equal(rateCard({ box: 5, reviews: 9 }, 'easy').box, 5);
    assert.equal(rateCard({ box: 1, reviews: 1 }, 'hard').box, 1);
  });

  test('records when and how the card was rated', () => {
    const p = rateCard({ box: 2, reviews: 4 }, 'good', at(3));
    assert.deepEqual(p, {
      box: 3,
      last_rating: 'good',
      last_reviewed_at: '2026-09-03T10:00:00.000Z',
      reviews: 5,
    });
  });

  test('rejects an unknown rating', () => {
    assert.throws(() => rateCard(undefined, 'meh'), RangeError);
  });
});

describe('nextSessionOrder', () => {
  test('failed cards first, then unseen, then lowest box, then least recently reviewed', () => {
    const cards = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => ({ id }));
    const progress = {
      f1: { box: 5, last_rating: 'easy', last_reviewed_at: at(1).toISOString() },
      f2: { box: 1, last_rating: 'again', last_reviewed_at: at(2).toISOString() },
      f4: { box: 3, last_rating: 'good', last_reviewed_at: at(2).toISOString() },
      f5: { box: 3, last_rating: 'good', last_reviewed_at: at(1).toISOString() },
    };
    assert.deepEqual(nextSessionOrder(cards, progress), ['f2', 'f3', 'f5', 'f4', 'f1']);
  });
});

describe('practiceSummary', () => {
  test('reports coverage and the weakest requirements', () => {
    const kit = {
      role: {
        requirements: [
          { id: 'r1', text: 'Go', priority: 'must' },
          { id: 'r2', text: 'SQL', priority: 'must' },
          { id: 'r3', text: 'Kafka', priority: 'nice' },
        ],
      },
      flashcards: [
        { id: 'f1', requirement_ids: ['r1'] },
        { id: 'f2', requirement_ids: ['r2'] },
        { id: 'f3', requirement_ids: ['r2'] },
      ],
    };
    const summary = practiceSummary(kit, { f1: { box: 5 }, f2: { box: 1 } });
    assert.equal(summary.reviewed, 2);
    assert.equal(summary.not_reviewed, 1);
    assert.equal(summary.mastered, 1);
    assert.deepEqual(summary.by_requirement[1], {
      requirement_id: 'r2',
      text: 'SQL',
      priority: 'must',
      cards: 2,
      reviewed: 1,
      confidence: 0.5,
    });
    assert.deepEqual(summary.weakest, ['r2', 'r1']);
  });
});
