// The kit structure from Appendix A of the brief, enforced in code.
//
// Field names are exact. Extra fields are allowed (the brief permits
// extensions), so kits may carry builder state (origin/edited/pinned) and a
// `meta` block. Beyond the shape, validateKit() checks the rules that make kits
// comparable: stable unique ids, references that point at real items, integer
// minutes, difficulty 1-3 and a schedule of exactly the requested length.

import { z } from 'zod';

const id = (prefix) => z.string().regex(new RegExp(`^${prefix}\\d+$`), `must look like ${prefix}1`);
const url = z.string().min(1);

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'];
export const PRIORITIES = ['must', 'nice'];
export const QUESTION_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];

export const kitSchema = z
  .object({
    source: z
      .object({
        company: z.string(),
        company_url: z.string(),
        role: z.string(),
        location: z.string(),
        jd_chars: z.number().int().nonnegative(),
        researched_at: z.string().datetime(),
        pages_used: z.array(url),
      })
      .passthrough(),

    company_brief: z
      .object({
        summary: z.string(),
        what_they_do: z.string(),
        sources: z.array(url),
      })
      .passthrough(),

    role: z
      .object({
        title: z.string(),
        seniority: z.string(),
        responsibilities: z.array(z.string()),
        requirements: z.array(
          z
            .object({
              id: id('r'),
              text: z.string().min(1),
              kind: z.enum(REQUIREMENT_KINDS),
              priority: z.enum(PRIORITIES),
            })
            .passthrough(),
        ),
      })
      .passthrough(),

    questions: z.array(
      z
        .object({
          id: id('q'),
          requirement_ids: z.array(id('r')),
          category: z.enum(QUESTION_CATEGORIES),
          prompt: z.string().min(1),
          answer_outline: z.string(),
          difficulty: z.number().int().min(1).max(3),
        })
        .passthrough(),
    ),

    flashcards: z.array(
      z
        .object({
          id: id('f'),
          front: z.string().min(1),
          back: z.string().min(1),
          requirement_ids: z.array(id('r')),
        })
        .passthrough(),
    ),

    schedule: z
      .object({
        days_available: z.number().int().min(1),
        days: z.array(
          z
            .object({
              day: z.number().int().min(1),
              focus: z.string().min(1),
              question_ids: z.array(id('q')),
              minutes: z.number().int().positive(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),

    coverage: z
      .object({
        uncovered_requirement_ids: z.array(id('r')),
        passes: z.number().int().min(1),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Checks a kit's shape and its internal consistency.
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateKit(kit) {
  const parsed = kitSchema.safeParse(kit);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const errors = [];
  const requirementIds = checkUnique(kit.role.requirements, 'requirement', errors);
  const questionIds = checkUnique(kit.questions, 'question', errors);
  checkUnique(kit.flashcards, 'flashcard', errors);

  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      if (!requirementIds.has(rid)) errors.push(`question ${q.id} references unknown ${rid}`);
    }
  }
  for (const f of kit.flashcards) {
    for (const rid of f.requirement_ids) {
      if (!requirementIds.has(rid)) errors.push(`flashcard ${f.id} references unknown ${rid}`);
    }
  }

  const { days_available: daysAvailable, days } = kit.schedule;
  if (days.length !== daysAvailable) {
    errors.push(`schedule has ${days.length} days but days_available is ${daysAvailable}`);
  }
  days.forEach((d, i) => {
    if (d.day !== i + 1) errors.push(`schedule day ${i + 1} is numbered ${d.day}`);
    for (const qid of d.question_ids) {
      if (!questionIds.has(qid)) errors.push(`schedule day ${d.day} references unknown ${qid}`);
    }
  });

  for (const rid of kit.coverage.uncovered_requirement_ids) {
    if (!requirementIds.has(rid)) errors.push(`coverage lists unknown ${rid}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

function checkUnique(items, label, errors) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`duplicate ${label} id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}
