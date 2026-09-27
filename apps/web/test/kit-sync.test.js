import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptServerIds, isDirty, rebase, sectionsOf, toPatch } from '../lib/kit-sync.js';

const q = (id, prompt, extra = {}) => ({
  id,
  category: 'technical',
  prompt,
  answer_outline: '',
  difficulty: 2,
  requirement_ids: [],
  pinned: false,
  ...extra,
});
const sections = (questions, flashcards = [], brief = {}, stories = []) => ({
  questions,
  flashcards,
  stories,
  company_brief: { summary: 'S', what_they_do: 'W', pinned: false, ...brief },
});

describe('rebase', () => {
  const base = sections([q('q1', 'one'), q('q2', 'two'), q('q3', 'three')]);

  test('keeps a local edit when the server replaced other questions (regeneration)', () => {
    const local = sections([q('q1', 'one, edited by me'), q('q2', 'two'), q('q3', 'three')]);
    const server = sections([q('q1', 'one'), q('q7', 'fresh'), q('q8', 'fresh too')]);
    const result = rebase(server, local, base);
    assert.deepEqual(
      result.questions.map((x) => [x.id, x.prompt]),
      [
        ['q1', 'one, edited by me'],
        ['q7', 'fresh'],
        ['q8', 'fresh too'],
      ],
    );
  });

  test('keeps local additions and deletions', () => {
    const local = sections([q('q1', 'one'), q('q3', 'three'), q('tmp-q-a', 'mine')]);
    const server = sections([q('q1', 'one'), q('q2', 'two, edited elsewhere'), q('q3', 'three')]);
    assert.deepEqual(
      rebase(server, local, base).questions.map((x) => x.id),
      ['q1', 'q3', 'tmp-q-a'],
    );
  });

  test('takes the server’s version of what the user did not touch', () => {
    const local = sections([q('q1', 'one'), q('q2', 'two'), q('q3', 'three')]);
    const server = sections([q('q1', 'one'), q('q2', 'two, edited elsewhere'), q('q3', 'three')]);
    assert.equal(rebase(server, local, base).questions[1].prompt, 'two, edited elsewhere');
  });

  test('keeps the user’s reordering, with server-only items in their place', () => {
    const local = sections([q('q3', 'three'), q('q1', 'one'), q('q2', 'two')]);
    const server = sections([q('q1', 'one'), q('q2', 'two'), q('q3', 'three'), q('q9', 'new')]);
    assert.deepEqual(
      rebase(server, local, base).questions.map((x) => x.id),
      ['q3', 'q1', 'q2', 'q9'],
    );
  });

  test('keeps a local pin and a local brief edit', () => {
    const local = sections([q('q1', 'one', { pinned: true }), q('q2', 'two'), q('q3', 'three')], [], {
      summary: 'My summary',
    });
    const server = sections([q('q1', 'one'), q('q2', 'two'), q('q3', 'three')], [], {
      what_they_do: 'New from server',
    });
    const result = rebase(server, local, base);
    assert.equal(result.questions[0].pinned, true);
    assert.equal(result.company_brief.summary, 'My summary');
    assert.equal(result.company_brief.what_they_do, 'New from server');
  });

  test('an edit to a question the server deleted is dropped', () => {
    const local = sections([q('q1', 'one'), q('q2', 'two, edited'), q('q3', 'three')]);
    const server = sections([q('q1', 'one'), q('q3', 'three')]);
    assert.deepEqual(
      rebase(server, local, base).questions.map((x) => x.id),
      ['q1', 'q3'],
    );
  });
});

describe('adoptServerIds', () => {
  test('renames temporary ids using the order the server returned', () => {
    const sent = sections([q('q1', 'one'), q('tmp-q-a', 'mine')]);
    const server = sections([q('q1', 'one'), q('q4', 'mine')]);
    // The user kept typing after the save was sent.
    const local = sections([q('q1', 'one'), q('tmp-q-a', 'mine, longer')]);
    const renamed = adoptServerIds(local, sent, server);
    assert.deepEqual(
      renamed.questions.map((x) => [x.id, x.prompt]),
      [
        ['q1', 'one'],
        ['q4', 'mine, longer'],
      ],
    );
  });
});

describe('stories', () => {
  const st = (id, title, question_ids = []) => ({
    id,
    title,
    situation: '',
    action: '',
    result: '',
    requirement_ids: [],
    question_ids,
  });

  test('a story linked to a new question follows the question’s real id', () => {
    const sent = sections([q('tmp-q-a', 'mine')], [], {}, [st('tmp-s-a', 'Outage', ['tmp-q-a'])]);
    const server = sections([q('q9', 'mine')], [], {}, [st('s1', 'Outage', ['q9'])]);
    const renamed = adoptServerIds(sent, sent, server);
    assert.equal(renamed.stories[0].id, 's1');
    assert.deepEqual(renamed.stories[0].question_ids, ['q9']);
  });

  test('story edits are rebased like any other item', () => {
    const base = sections([], [], {}, [st('s1', 'Outage')]);
    const local = sections([], [], {}, [st('s1', 'The big outage'), st('tmp-s-b', 'New one')]);
    const server = sections([], [], {}, [st('s1', 'Outage')]);
    assert.deepEqual(
      rebase(server, local, base).stories.map((x) => x.title),
      ['The big outage', 'New one'],
    );
  });
});

describe('isDirty and toPatch', () => {
  const kit = {
    questions: [{ ...q('q1', 'one'), origin: 'generated', edited: false }],
    flashcards: [],
    company_brief: { summary: 'S', what_they_do: 'W', sources: [], hiring_process: {} },
  };

  test('detects edits, and ignores fields the editor does not own', () => {
    const base = sectionsOf(kit);
    assert.equal(isDirty(base, base), false);
    assert.equal(isDirty({ ...base, questions: [{ ...base.questions[0], prompt: 'x' }] }, base), true);
    assert.equal(isDirty({ ...base, questions: [{ ...base.questions[0], edited: true }] }, base), false);
  });

  test('toPatch sends only editable fields', () => {
    const patch = toPatch(sectionsOf(kit), 3);
    assert.equal(patch.version, 3);
    assert.deepEqual(Object.keys(patch.questions[0]).sort(), [
      'answer_outline',
      'category',
      'difficulty',
      'id',
      'pinned',
      'prompt',
      'requirement_ids',
    ]);
  });
});
