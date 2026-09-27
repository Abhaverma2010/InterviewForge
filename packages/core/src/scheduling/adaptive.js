// Adaptive planning: readiness from practice, and re-planning the days left.
//
// The problem it solves: a study plan goes stale. You skip a day, or practice
// shows a must-have you thought you knew is shaky. "Re-plan from today" takes
// the days that are actually left and front-loads your weakest must-have
// requirements, using the confidence recorded in practice mode.
//
// Readiness per requirement is the average Leitner box of its flashcards,
// scaled to 0-1 (an unseen card counts as 0: you have not shown you know it).
// The overall score weights must-haves twice as heavily as nice-to-haves.
// All of this is arithmetic in code; no model is involved.

import { buildSchedule } from './schedule.js';

const MAX_BOX = 5;
const SHAKY_BELOW = 0.6; // box 3 of 5
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} kit
 * @param {Record<string, { box: number }>} cards  practice progress by flashcard id
 */
export function readiness(kit, cards = {}) {
  const requirements = kit.role.requirements.map((r) => {
    const own = kit.flashcards.filter((f) => f.requirement_ids.includes(r.id));
    const reviewed = own.filter((f) => cards[f.id]).length;
    const confidence = own.length
      ? own.reduce((sum, f) => sum + (cards[f.id]?.box ?? 0) / MAX_BOX, 0) / own.length
      : null; // no cards to measure it with
    return {
      id: r.id,
      text: r.text,
      priority: r.priority,
      cards: own.length,
      reviewed,
      confidence,
    };
  });

  const weights = requirements.map((r) => (r.priority === 'must' ? 2 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const score = totalWeight
    ? Math.round(
        (100 * requirements.reduce((sum, r, i) => sum + (r.confidence ?? 0) * weights[i], 0)) /
          totalWeight,
      )
    : 0;

  const shakyMust = requirements
    .filter((r) => r.priority === 'must' && (r.confidence ?? 0) < SHAKY_BELOW)
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))
    .map((r) => r.id);

  return { score, requirements, shaky_must: shakyMust };
}

/** Which day of the plan `today` is (1 on the start date), from the schedule's start date. */
export function currentDay(kit, today = new Date()) {
  const start = startDateOf(kit);
  const elapsed = Math.floor((utcDay(today) - utcDay(new Date(start))) / DAY_MS);
  return Math.max(1, elapsed + 1);
}

/** Days left, counting today, never fewer than 1. */
export function daysLeft(kit, today = new Date()) {
  return Math.max(1, kit.schedule.days_available - (currentDay(kit, today) - 1));
}

/**
 * A new schedule over the days that are left (or `days`), starting today,
 * with must-have material first and, within it, the weakest requirements first.
 */
export function replanSchedule(kit, cards = {}, { today = new Date(), days } = {}) {
  const ready = readiness(kit, cards);
  const weakness = new Map(ready.requirements.map((r) => [r.id, 1 - (r.confidence ?? 0)]));
  const remaining = days ?? daysLeft(kit, today);
  return {
    ...buildSchedule({
      requirements: kit.role.requirements,
      questions: kit.questions,
      days: remaining,
      weakness,
    }),
    start_date: isoDate(today),
    adaptive: {
      replanned_at: today.toISOString(),
      readiness_score: ready.score,
      prioritised: ready.shaky_must,
    },
  };
}

export function startDateOf(kit) {
  return kit.schedule.start_date ?? kit.source.researched_at.slice(0, 10);
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
