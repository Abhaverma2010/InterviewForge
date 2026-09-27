// The builder: editing a kit, and regenerating one section without losing
// the user's work elsewhere.
//
// State model. Every question and flashcard carries:
//   origin   'generated' | 'template' | 'user'   who wrote it
//   edited   true once a user has changed any of its content
//   pinned   the user asked us to keep it as it is
// The company brief carries `edited` and `pinned` too.
//
// `edited` is decided here, by comparing what the client saved with what is
// stored, never taken from the client: a stale or buggy client cannot clear
// it, and it cannot be forgotten. `pinned` is a user choice and is taken as sent.
//
// A regeneration only replaces items that are generated, unedited and
// unpinned. Everything the user wrote, touched or pinned survives it.

import { findCoverageGaps } from '../coverage/coverage.js';
import { buildCompanyBrief } from '../generation/company-research.js';
import { CATEGORY_FOR_KIND, generateQuestions } from '../generation/questions.js';
import { guessCompanyName } from '../retrieval/company-name.js';
import { crawlCompany } from '../retrieval/crawler.js';
import { buildSchedule } from '../scheduling/schedule.js';
import { QUESTION_CATEGORIES, validateKit } from '../validation/kit-schema.js';

export class BuilderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BuilderError';
    this.code = code;
    this.details = details;
  }
}

const QUESTION_FIELDS = ['prompt', 'answer_outline', 'difficulty', 'category', 'requirement_ids'];
const FLASHCARD_FIELDS = ['front', 'back', 'requirement_ids'];
const BRIEF_FIELDS = ['summary', 'what_they_do'];

/** A generated item the user has not touched: safe to replace. */
export function isReplaceable(item) {
  return item.origin !== 'user' && !item.edited && !item.pinned;
}

// ─── Edits ───────────────────────────────────────────────────────────────────

/**
 * Applies a client's saved sections to a kit and returns the new kit.
 * The arrays are taken in the order sent, which is how reordering works.
 * Items with an id the kit does not have are new, user-written items and get
 * the next free id. Deleted questions are removed from the schedule.
 *
 * @param {object} kit  the stored kit
 * @param {object} changes
 * @param {object[]} [changes.questions]  the full, reordered question list
 * @param {object[]} [changes.flashcards]  the full flashcard list
 * @param {{ summary?: string, what_they_do?: string, pinned?: boolean }} [changes.company_brief]
 */
export function applyEdits(kit, changes) {
  const next = structuredClone(kit);
  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));

  if (changes.questions) {
    next.questions = mergeItems(kit.questions, changes.questions, {
      prefix: 'q',
      fields: QUESTION_FIELDS,
      normalise: (q) => ({
        requirement_ids: (q.requirement_ids ?? []).filter((id) => requirementIds.has(id)),
        category: q.category,
        prompt: String(q.prompt ?? '').trim(),
        answer_outline: String(q.answer_outline ?? '').trim(),
        difficulty: q.difficulty,
      }),
    });
    const ids = new Set(next.questions.map((q) => q.id));
    for (const day of next.schedule.days) {
      day.question_ids = day.question_ids.filter((id) => ids.has(id));
    }
  }

  if (changes.flashcards) {
    next.flashcards = mergeItems(kit.flashcards, changes.flashcards, {
      prefix: 'f',
      fields: FLASHCARD_FIELDS,
      normalise: (f) => ({
        front: String(f.front ?? '').trim(),
        back: String(f.back ?? '').trim(),
        requirement_ids: (f.requirement_ids ?? []).filter((id) => requirementIds.has(id)),
      }),
    });
  }

  if (changes.company_brief) {
    const before = kit.company_brief;
    const after = { ...before };
    for (const field of BRIEF_FIELDS) {
      if (typeof changes.company_brief[field] === 'string') {
        after[field] = changes.company_brief[field].trim();
      }
    }
    after.edited = Boolean(before.edited) || BRIEF_FIELDS.some((f) => after[f] !== before[f]);
    if (typeof changes.company_brief.pinned === 'boolean')
      after.pinned = changes.company_brief.pinned;
    next.company_brief = after;
  }

  return finish(next);
}

function mergeItems(stored, sent, { prefix, fields, normalise }) {
  const byId = new Map(stored.map((item) => [item.id, item]));
  let nextNumber = Math.max(0, ...stored.map((item) => idNumber(item.id))) + 1;
  const used = new Set();

  return sent.map((raw) => {
    const content = normalise(raw);
    const previous = byId.get(raw.id);
    if (previous && !used.has(previous.id)) {
      used.add(previous.id);
      const changed = fields.some((f) => !sameValue(previous[f], content[f]));
      return {
        ...previous,
        ...content,
        edited: Boolean(previous.edited) || changed,
        pinned: typeof raw.pinned === 'boolean' ? raw.pinned : Boolean(previous.pinned),
      };
    }
    // Unknown (or duplicated) id: a new item the user wrote.
    return {
      id: `${prefix}${nextNumber++}`,
      ...content,
      origin: 'user',
      edited: false,
      pinned: Boolean(raw.pinned),
    };
  });
}

// ─── Regeneration ────────────────────────────────────────────────────────────

/**
 * Regenerates one question category. Replaceable questions in that category
 * are dropped and fresh ones generated; the user's questions (written, edited
 * or pinned) stay where they are. Must-have requirements of the category that
 * end up uncovered get one gap-filling pass.
 */
export async function regenerateCategory(kit, category, { llm }) {
  if (!QUESTION_CATEGORIES.includes(category)) {
    throw new BuilderError('INVALID_CATEGORY', `Unknown question category: ${category}`);
  }
  const requirements = requirementsFor(kit, category);
  if ((category === 'technical' || category === 'system-design') && !requirements.length) {
    throw new BuilderError(
      'NOTHING_TO_GENERATE',
      `This role has no requirements for ${category} questions.`,
    );
  }

  const context = contextOf(kit);
  const kept = kit.questions.filter((q) => q.category !== category || !isReplaceable(q));
  const keptInCategory = kept.filter((q) => q.category === category).length;
  const count = Math.max(2, defaultCount(category, requirements) - keptInCategory);

  let fresh = await generateQuestions({ category, requirements, count, context }, { llm });

  // Keep the promise that no must-have ships uncovered.
  const covered = [...kept, ...fresh];
  const gaps = findCoverageGaps(kit.role.requirements, covered).uncoveredMust.filter((id) =>
    requirements.some((r) => r.id === id),
  );
  if (gaps.length) {
    const missing = requirements.filter((r) => gaps.includes(r.id));
    const filled = await generateQuestions(
      { category, requirements: missing, count: missing.length, context, gapFill: true },
      { llm },
    );
    fresh = [...fresh, ...filled];
  }

  const next = structuredClone(kit);
  let nextNumber = Math.max(0, ...kit.questions.map((q) => idNumber(q.id))) + 1;
  const freshItems = fresh.map((q) => ({
    id: `q${nextNumber++}`,
    ...q,
    origin: 'generated',
    edited: false,
    pinned: false,
  }));

  // New questions go where the category's old ones were, so the list keeps its shape.
  const firstIndex = kit.questions.findIndex((q) => q.category === category);
  const insertAt =
    firstIndex === -1
      ? kept.length
      : kept.filter((q, i) => kit.questions.indexOf(q) < firstIndex).length;
  next.questions = [...kept.slice(0, insertAt), ...freshItems, ...kept.slice(insertAt)];

  const ids = new Set(next.questions.map((q) => q.id));
  for (const day of next.schedule.days)
    day.question_ids = day.question_ids.filter((id) => ids.has(id));
  return finish(next);
}

/** Rebuilds the schedule from the kit's current questions. */
export function regenerateSchedule(kit) {
  const next = structuredClone(kit);
  next.schedule = buildSchedule({
    requirements: kit.role.requirements,
    questions: kit.questions,
    days: kit.schedule.days_available,
  });
  return finish(next);
}

/**
 * Re-researches the company and rewrites the brief. Refused when the brief
 * is pinned. The hiring process and everything else in the kit are kept.
 */
export async function regenerateBrief(kit, { llm, crawler }) {
  if (kit.company_brief.pinned) {
    throw new BuilderError('PINNED', 'The company brief is pinned. Unpin it to regenerate.');
  }
  const crawl = await crawlCompany(kit.source.company_url, crawler);
  const home = crawl.pages.find((p) => p.kind === 'home');
  const company =
    kit.source.company ||
    guessCompanyName({ siteName: home?.siteName, title: home?.title, url: kit.source.company_url });
  const brief = await buildCompanyBrief({ company, crawl }, { llm });

  const next = structuredClone(kit);
  next.company_brief = {
    ...kit.company_brief,
    summary: brief.summary,
    what_they_do: brief.what_they_do,
    sources: brief.sources,
    found: brief.found,
    edited: false,
    pinned: false,
  };
  next.source.pages_used = [...new Set([...kit.source.pages_used, ...brief.sources])];
  return finish(next);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Coverage is recomputed after every change, so the kit always tells the truth.
function finish(kit) {
  kit.coverage = {
    ...kit.coverage,
    uncovered_requirement_ids: findCoverageGaps(kit.role.requirements, kit.questions).uncovered,
  };
  const check = validateKit(kit);
  if (!check.ok) throw new BuilderError('INVALID_KIT', check.errors[0], check.errors);
  return kit;
}

function requirementsFor(kit, category) {
  const reqs = kit.role.requirements;
  if (category === 'technical' || category === 'system-design') {
    return reqs.filter((r) => CATEGORY_FOR_KIND[r.kind] === 'technical');
  }
  if (category === 'behavioural') return reqs.filter((r) => r.kind === 'behavioural');
  return reqs.filter((r) => r.kind === 'domain');
}

function defaultCount(category, requirements) {
  if (category === 'technical')
    return Math.min(10, Math.max(3, Math.ceil(requirements.length * 1.5)));
  if (category === 'behavioural') return Math.min(5, Math.max(2, requirements.length + 1));
  if (category === 'system-design') return 2;
  return 3;
}

function contextOf(kit) {
  return {
    company: kit.source.company,
    role: {
      title: kit.role.title,
      seniority: kit.role.seniority,
      responsibilities: kit.role.responsibilities,
    },
    brief: {
      found: kit.company_brief.found !== false,
      summary: kit.company_brief.summary,
      what_they_do: kit.company_brief.what_they_do,
    },
    hiringProcess: kit.company_brief.hiring_process ?? { found: false, stages: [] },
  };
}

function idNumber(id) {
  const n = Number(String(id).slice(1));
  return Number.isInteger(n) ? n : 0;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
