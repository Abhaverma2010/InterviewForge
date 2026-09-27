// Kit endpoints. Every route is behind requireAuth, and every lookup is scoped
// to the signed-in user: someone else's kit answers 404, exactly like a kit
// that does not exist, so ids cannot be probed.
//
//   GET    /api/kits                    list my kits
//   POST   /api/kits                    create one (202, generated in the background)
//   POST   /api/kits/batch              create several (from pasted items or an uploaded file)
//   GET    /api/kits/:id                the full record, including the kit
//   GET    /api/kits/:id/status         lightweight, for polling during generation
//   PATCH  /api/kits/:id                save edits (optimistic concurrency on `version`)
//   POST   /api/kits/:id/regenerate     regenerate the brief, one question category, or the schedule
//   POST   /api/kits/:id/retry          re-run a failed generation
//   DELETE /api/kits/:id
//   GET    /api/kits/:id/practice       next session order + progress summary
//   POST   /api/kits/:id/practice       record a flashcard rating

import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  applyBrief,
  applyEdits,
  BuilderError,
  generateBrief,
  generateCategoryQuestions,
  MAX_DAYS,
  MAX_JD_CHARS,
  mergeCategory,
  nextSessionOrder,
  practiceSummary,
  QUESTION_CATEGORIES,
  RATINGS,
  rateCard,
  regenerateSchedule,
} from '@interviewforge/core';
import { ApiError, handle, rateLimit, validateBody } from '../http.js';
import { requireAuth } from './auth.js';

const kitInput = z.object({
  jd: z
    .string()
    .trim()
    .min(1, 'Paste the job description.')
    .max(MAX_JD_CHARS, `Keep the job description under ${MAX_JD_CHARS} characters.`),
  company_url: z
    .string()
    .trim()
    .min(1, 'Enter the company website.')
    .max(2048)
    .transform(withScheme)
    .refine(isWebUrl, 'Enter a website address such as https://example.com.'),
  days: z.coerce
    .number()
    .int('Days must be a whole number.')
    .min(1, 'At least 1 day.')
    .max(MAX_DAYS, `At most ${MAX_DAYS} days.`),
});

const questionItem = z.object({
  id: z.string().max(64),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().trim().min(1, 'A question cannot be empty.').max(4000),
  answer_outline: z.string().max(8000).default(''),
  difficulty: z.number().int().min(1).max(3),
  requirement_ids: z.array(z.string().max(16)).max(50).default([]),
  pinned: z.boolean().optional(),
});
const flashcardItem = z.object({
  id: z.string().max(64),
  front: z.string().trim().min(1, 'The front of a card cannot be empty.').max(2000),
  back: z.string().trim().min(1, 'The back of a card cannot be empty.').max(4000),
  requirement_ids: z.array(z.string().max(16)).max(50).default([]),
  pinned: z.boolean().optional(),
});
const editBody = z.object({
  version: z.number().int().min(1),
  questions: z.array(questionItem).max(300).optional(),
  flashcards: z.array(flashcardItem).max(300).optional(),
  company_brief: z
    .object({
      summary: z.string().max(5000).optional(),
      what_they_do: z.string().max(5000).optional(),
      pinned: z.boolean().optional(),
    })
    .optional(),
});
const regenerateBody = z.discriminatedUnion('section', [
  z.object({ section: z.literal('brief') }),
  z.object({ section: z.literal('questions'), category: z.enum(QUESTION_CATEGORIES) }),
  z.object({
    section: z.literal('schedule'),
    days: z.number().int().min(1).max(MAX_DAYS).optional(),
  }),
]);

const SAVE_ATTEMPTS = 3;

export function kitRoutes({ store, queue, llm, crawler }) {
  const router = Router();
  router.use(requireAuth);
  const createLimiter = rateLimit({ windowMs: 60 * 60_000, max: 60, code: 'TOO_MANY_KITS' });
  const regenerating = new Set();

  async function ownedRecord(req) {
    const record = await store.kits.get(req.params.id);
    if (!record || record.owner !== req.userId) {
      throw new ApiError(404, 'KIT_NOT_FOUND', 'That kit does not exist.');
    }
    return record;
  }
  const readyRecord = async (req) => {
    const record = await ownedRecord(req);
    if (record.status !== 'ready') {
      throw new ApiError(409, 'KIT_NOT_READY', `This kit is ${record.status}, not ready yet.`);
    }
    return record;
  };

  // Creates a kit unless the same posting is already there. Returns { record, duplicate }.
  async function createKit(owner, input, { force = false } = {}) {
    const inputHash = hashInput(input);
    const existing = await store.kits.findByHash(owner, inputHash);
    if (existing && existing.status !== 'failed' && !force)
      return { record: existing, duplicate: true };

    const record = await store.kits.create({
      owner,
      input_hash: inputHash,
      input,
      status: 'queued',
      progress: null,
      error: null,
      kit: null,
      version: 0,
      practice: { cards: {} },
    });
    queue.enqueue(record.id);
    return { record, duplicate: false };
  }

  router.get(
    '/',
    handle(async (req, res) => {
      const records = await store.kits.listByOwner(req.userId);
      res.json({ kits: records.map(summary) });
    }),
  );

  router.post(
    '/',
    createLimiter,
    validateBody(kitInput.extend({ force: z.boolean().optional() })),
    handle(async (req, res) => {
      const { force, ...input } = req.body;
      const { record, duplicate } = await createKit(req.userId, input, { force });
      res.status(duplicate ? 200 : 202).json({ kit: summary(record), duplicate });
    }),
  );

  router.post(
    '/batch',
    createLimiter,
    validateBody(
      z.object({ items: z.array(z.unknown()).min(1).max(10, 'At most 10 roles at once.') }),
    ),
    handle(async (req, res) => {
      const results = [];
      for (const [index, raw] of req.body.items.entries()) {
        const parsed = kitInput.safeParse(raw);
        if (!parsed.success) {
          results.push({
            index,
            error: {
              code: 'INVALID_ITEM',
              message: parsed.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; '),
            },
          });
          continue;
        }
        const { record, duplicate } = await createKit(req.userId, parsed.data);
        results.push({ index, kit: summary(record), duplicate });
      }
      res.status(202).json({ results });
    }),
  );

  router.get(
    '/:id',
    handle(async (req, res) => {
      res.json({ kit: full(await ownedRecord(req)) });
    }),
  );

  router.get(
    '/:id/status',
    handle(async (req, res) => {
      const record = await ownedRecord(req);
      res.json({
        id: record.id,
        status: record.status,
        progress: record.progress,
        error: record.error,
        version: record.version,
        queue_position: record.status === 'queued' ? queue.position(record.id) : null,
      });
    }),
  );

  router.patch(
    '/:id',
    validateBody(editBody),
    handle(async (req, res) => {
      const record = await readyRecord(req);
      const { version, ...changes } = req.body;
      if (record.version !== version) throw conflict(record);

      let kit;
      try {
        kit = applyEdits(record.kit, changes);
      } catch (err) {
        if (err instanceof BuilderError)
          throw new ApiError(422, 'INVALID_EDIT', err.message, err.details);
        throw err;
      }
      const saved = await store.kits.updateIfVersion(record.id, version, { kit });
      if (!saved) throw conflict(await store.kits.get(record.id));
      res.json({ kit: full(saved) });
    }),
  );

  router.post(
    '/:id/regenerate',
    validateBody(regenerateBody),
    handle(async (req, res) => {
      const record = await readyRecord(req);
      const { section } = req.body;
      const lockKey = `${record.id}:${section}:${req.body.category ?? ''}`;
      if (regenerating.has(lockKey)) {
        throw new ApiError(
          409,
          'ALREADY_REGENERATING',
          'This section is already being regenerated.',
        );
      }
      regenerating.add(lockKey);
      try {
        // The slow, model-backed part runs on the kit as it was at the start...
        let merge;
        if (section === 'schedule') {
          merge = (kit) => regenerateSchedule(kit, { days: req.body.days });
        } else if (section === 'questions') {
          const fresh = await generateCategoryQuestions(record.kit, req.body.category, { llm });
          merge = (kit) => mergeCategory(kit, req.body.category, fresh);
        } else {
          const brief = await generateBrief(record.kit, { llm, crawler });
          const briefAtStart = briefKey(record.kit);
          merge = (kit) => {
            if (briefKey(kit) !== briefAtStart) {
              throw new ApiError(
                409,
                'BRIEF_CHANGED',
                'The brief was edited while it was being regenerated. Your edit was kept.',
              );
            }
            return applyBrief(kit, brief);
          };
        }
        // ...and the result is merged onto the latest saved kit, so edits the
        // user made in the meantime survive.
        const saved = await saveMerged(record.id, merge);
        res.json({ kit: full(saved) });
      } catch (err) {
        throw toApiError(err);
      } finally {
        regenerating.delete(lockKey);
      }
    }),
  );

  // Applies `merge` to the latest version and saves it with a compare-and-set,
  // retrying if another save lands in between.
  async function saveMerged(id, merge) {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const latest = await store.kits.get(id);
      const saved = await store.kits.updateIfVersion(id, latest.version, {
        kit: merge(latest.kit),
      });
      if (saved) return saved;
    }
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      'The kit kept changing while saving. Please try again.',
    );
  }

  router.post(
    '/:id/retry',
    handle(async (req, res) => {
      const record = await ownedRecord(req);
      if (record.status !== 'failed') {
        throw new ApiError(409, 'NOT_FAILED', 'Only a failed kit can be retried.');
      }
      const updated = await store.kits.update(record.id, {
        status: 'queued',
        error: null,
        progress: null,
      });
      queue.enqueue(record.id);
      res.status(202).json({ kit: summary(updated) });
    }),
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      const record = await ownedRecord(req);
      await store.kits.remove(record.id);
      res.status(204).end();
    }),
  );

  router.get(
    '/:id/practice',
    handle(async (req, res) => {
      const record = await readyRecord(req);
      res.json(practiceState(record));
    }),
  );

  router.post(
    '/:id/practice',
    validateBody(z.object({ card_id: z.string().max(16), rating: z.enum(RATINGS) })),
    handle(async (req, res) => {
      const record = await readyRecord(req);
      const { card_id: cardId, rating } = req.body;
      if (!record.kit.flashcards.some((f) => f.id === cardId)) {
        throw new ApiError(404, 'CARD_NOT_FOUND', 'That flashcard is not in this kit.');
      }
      const progress = rateCard(record.practice?.cards?.[cardId], rating);
      const saved = await store.kits.setCardProgress(record.id, cardId, progress);
      res.json({ progress, ...practiceState(saved) });
    }),
  );

  return router;
}

function practiceState(record) {
  const cards = record.practice?.cards ?? {};
  return {
    order: nextSessionOrder(record.kit.flashcards, cards),
    cards,
    summary: practiceSummary(record.kit, cards),
  };
}

function summary(record) {
  return {
    id: record.id,
    status: record.status,
    title: record.kit?.role.title ?? firstLine(record.input.jd),
    company: record.kit?.source.company ?? hostOf(record.input.company_url),
    company_url: record.input.company_url,
    days: record.input.days,
    thin: record.kit?.role.thin ?? null,
    progress: record.progress ? { current: record.progress.current } : null,
    error: record.error,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function full(record) {
  const { input_hash, owner, ...rest } = record;
  return rest;
}

function conflict(record) {
  return new ApiError(409, 'VERSION_CONFLICT', 'This kit changed since you loaded it.', {
    version: record.version,
    kit: record.kit,
  });
}

function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof BuilderError) {
    const status = err.code === 'PINNED' ? 409 : 422;
    return new ApiError(status, err.code, err.message, err.details);
  }
  if (err.name === 'LLMError') {
    return new ApiError(
      503,
      err.code,
      'The AI model is unavailable right now. Please try again in a minute.',
    );
  }
  return err;
}

// Same posting + same company = same kit, regardless of whitespace or case.
export function hashInput({ jd, company_url }) {
  const normalJd = jd.replace(/\s+/g, ' ').trim().toLowerCase();
  let normalUrl = company_url.trim().toLowerCase();
  try {
    const u = new URL(normalUrl);
    normalUrl = `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    // keep as is
  }
  return createHash('sha256').update(`${normalJd}\n${normalUrl}`).digest('hex');
}

function withScheme(url) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

function isWebUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function briefKey(kit) {
  const { summary: s, what_they_do: w, pinned } = kit.company_brief;
  return JSON.stringify([s, w, pinned]);
}

function firstLine(text) {
  return (
    text
      .split('\n')
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 80) ?? 'Untitled'
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
