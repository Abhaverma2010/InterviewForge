import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuestions, templateQuestion } from '../src/generation/questions.js';

const requirements = [
  { id: 'r1', text: 'React', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Built a startup', kind: 'domain', priority: 'nice' },
];
const q = (prompt, requirement_ids = ['r1'], difficulty = 2) => ({
  prompt,
  requirement_ids,
  answer_outline: '- x',
  difficulty,
});

describe('cleanQuestions', () => {
  test('files "tell me about a time" questions as behavioural (seen for PostHog)', () => {
    const [story, concept] = cleanQuestions(
      [
        q(
          'Tell me about a time you built a product feature from scratch under tight constraints.',
          ['r2'],
        ),
        q('How does React reconcile a list with keys?'),
      ],
      { category: 'technical', requirements },
    );
    assert.equal(story.category, 'behavioural');
    assert.equal(concept.category, 'technical');
  });

  test('drops ids that were not offered, and technical questions left citing nothing', () => {
    const cleaned = cleanQuestions([q('Explain hooks.', ['r1', 'r9']), q('Explain JSX.', ['r9'])], {
      category: 'technical',
      requirements,
    });
    assert.deepEqual(
      cleaned.map((c) => c.requirement_ids),
      [['r1']],
    );
  });

  test('keeps behavioural questions without requirement ids', () => {
    const cleaned = cleanQuestions([q('How do you handle conflict?', [])], {
      category: 'behavioural',
      requirements,
    });
    assert.equal(cleaned.length, 1);
  });

  test('clamps difficulty to an integer from 1 to 3 and removes duplicates', () => {
    const cleaned = cleanQuestions(
      [q('Explain hooks.', ['r1'], 7), q('explain HOOKS', ['r1']), q('Explain JSX.', ['r1'], 0.4)],
      { category: 'technical', requirements },
    );
    assert.deepEqual(
      cleaned.map((c) => c.difficulty),
      [3, 1],
    );
  });
});

describe('templateQuestion', () => {
  test('writes a category-appropriate question citing the requirement', () => {
    const t = templateQuestion({ id: 'r3', text: 'mentoring juniors', kind: 'behavioural' });
    assert.equal(t.category, 'behavioural');
    assert.deepEqual(t.requirement_ids, ['r3']);
    assert.match(t.prompt, /mentoring juniors/);
  });
});
