// Keeping the editor's local draft and the server's kit in step.
//
// The editor applies every change to a local draft immediately, and saves in
// the background. Three copies of the editable sections matter:
//   base    what the server had when we last synced
//   local   what the user sees now (base + their unsaved changes)
//   server  a newer version from the server (after a save, a regeneration,
//           or a conflict with another tab)
// rebase() replays the user's unsaved changes (edits, additions, deletions,
// reordering) on top of the server's version, so neither side's work is lost.
// Pure functions, so they are unit tested without a browser.

const QUESTION_FIELDS = ['category', 'prompt', 'answer_outline', 'difficulty', 'requirement_ids', 'pinned'];
const FLASHCARD_FIELDS = ['front', 'back', 'requirement_ids', 'pinned'];
const BRIEF_FIELDS = ['summary', 'what_they_do', 'pinned'];

/** The parts of a kit the builder edits. */
export function sectionsOf(kit) {
  return {
    questions: kit.questions,
    flashcards: kit.flashcards,
    company_brief: {
      summary: kit.company_brief.summary,
      what_they_do: kit.company_brief.what_they_do,
      pinned: Boolean(kit.company_brief.pinned),
    },
  };
}

/** The body of a PATCH request for these sections. */
export function toPatch(sections, version) {
  const pick = (item, fields) => Object.fromEntries(['id', ...fields].map((f) => [f, item[f]]));
  return {
    version,
    questions: sections.questions.map((q) => pick(q, QUESTION_FIELDS)),
    flashcards: sections.flashcards.map((f) => pick(f, FLASHCARD_FIELDS)),
    company_brief: sections.company_brief,
  };
}

export function isDirty(local, base) {
  return (
    listsDiffer(local.questions, base.questions, QUESTION_FIELDS) ||
    listsDiffer(local.flashcards, base.flashcards, FLASHCARD_FIELDS) ||
    BRIEF_FIELDS.some((f) => !same(local.company_brief[f], base.company_brief[f]))
  );
}

/** A temporary id for an item created in the browser; the server assigns the real one. */
export function tempId(prefix) {
  return `tmp-${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
export const isTempId = (id) => String(id).startsWith('tmp-');

/**
 * After a save, the server returns the lists in the order we sent them, with
 * real ids for our temporary ones. Renames those temporary ids in `local`
 * (which may have moved on since the save was sent).
 */
export function adoptServerIds(local, sent, server) {
  const renames = new Map();
  for (const key of ['questions', 'flashcards']) {
    sent[key].forEach((item, i) => {
      if (isTempId(item.id) && server[key][i]) renames.set(item.id, server[key][i].id);
    });
  }
  if (!renames.size) return local;
  const rename = (item) => (renames.has(item.id) ? { ...item, id: renames.get(item.id) } : item);
  return { ...local, questions: local.questions.map(rename), flashcards: local.flashcards.map(rename) };
}

/**
 * Replays the user's changes (local relative to base) onto the server's
 * newer sections.
 *   - items the user edited keep the user's content
 *   - items the user added are kept
 *   - items the user deleted stay deleted
 *   - if the user reordered, their order wins for the items they know about;
 *     items only the server has (e.g. freshly regenerated) keep their place
 *   - everything the user did not touch comes from the server
 */
export function rebase(server, local, base) {
  return {
    questions: rebaseList(server.questions, local.questions, base.questions, QUESTION_FIELDS),
    flashcards: rebaseList(server.flashcards, local.flashcards, base.flashcards, FLASHCARD_FIELDS),
    company_brief: Object.fromEntries(
      BRIEF_FIELDS.map((f) => [
        f,
        same(local.company_brief[f], base.company_brief[f])
          ? server.company_brief[f]
          : local.company_brief[f],
      ]),
    ),
  };
}

function rebaseList(server, local, base, fields) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));

  const deleted = new Set(base.filter((item) => !localById.has(item.id)).map((item) => item.id));
  const changed = new Map(
    local
      .filter((item) => baseById.has(item.id) && fields.some((f) => !same(item[f], baseById.get(item.id)[f])))
      .map((item) => [item.id, item]),
  );
  const added = local.filter((item) => !baseById.has(item.id));

  let result = server
    .filter((item) => !deleted.has(item.id))
    .map((item) => (changed.has(item.id) ? { ...item, ...pickFields(changed.get(item.id), fields) } : item));
  const serverIds = new Set(result.map((item) => item.id));
  result = [...result, ...added.filter((item) => !serverIds.has(item.id))];

  const baseOrder = base.map((item) => item.id).filter((id) => localById.has(id));
  const localOrder = local.map((item) => item.id).filter((id) => baseById.has(id));
  if (!same(baseOrder, localOrder)) {
    const position = new Map(local.map((item, i) => [item.id, i]));
    const serverPosition = new Map(result.map((item, i) => [item.id, i]));
    result = [...result].sort((a, b) => {
      const pa = position.get(a.id);
      const pb = position.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      return serverPosition.get(a.id) - serverPosition.get(b.id);
    });
  }
  return result;
}

function pickFields(item, fields) {
  return Object.fromEntries(fields.map((f) => [f, item[f]]));
}

function listsDiffer(a, b, fields) {
  if (a.length !== b.length) return true;
  return a.some((item, i) => item.id !== b[i].id || fields.some((f) => !same(item[f], b[i][f])));
}

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
