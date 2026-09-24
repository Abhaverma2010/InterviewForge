// Builds the day-by-day study schedule. Plain arithmetic, no model involved:
// the brief requires allocation to be the application's decision.
//
// Approach:
//   1. Give every question a cost in whole minutes (harder = longer).
//   2. Sort questions so must-have and harder material comes first.
//   3. Split that list across the learning days, front-loaded.
//   4. Any day with no new material (the final day when there are 3+ days,
//      or spare days when there are more days than questions) becomes a
//      review day that revisits must-have questions.

const REVIEW_QUESTIONS_PER_DAY = 4;
const EMPTY_KIT_MINUTES = 30;

// ─── Your part ──────────────────────────────────────────────────────────────
// Fill in the three functions below, then run `npm test` from the repo root.
// The tests in packages/core/test/schedule.test.js describe exactly what each
// one must do. Delete the `throw` line when you start on a function.

/**
 * How many minutes to spend on one question.
 * Rule: 10 minutes, plus 10 per difficulty level.
 *   difficulty 1 → 20, difficulty 2 → 30, difficulty 3 → 40
 *
 * @param {{ difficulty: number }} question
 * @returns {number} an integer
 */
export function questionCost(question) {
  throw new Error('TODO: questionCost');
}

/**
 * Returns a NEW array of the questions in study order:
 *   1. questions covering a must-have requirement come before the rest
 *   2. within each group, higher difficulty comes first
 *   3. otherwise keep the original order
 * Must not change the array it was given.
 *
 * Hints:
 *   - isMustHave(question, requirementsById) is written for you below.
 *   - [...questions] makes a copy. Array.prototype.sort is stable, so equal
 *     items keep their original order automatically.
 *   - A sort comparator returns a negative number to put `a` first.
 *
 * @param {Array<{ id: string, requirement_ids: string[], difficulty: number }>} questions
 * @param {Map<string, { priority: 'must' | 'nice' }>} requirementsById
 */
export function sortForSchedule(questions, requirementsById) {
  throw new Error('TODO: sortForSchedule');
}

/**
 * Splits `items` into exactly `dayCount` consecutive groups whose sizes
 * differ by at most one, with the bigger groups first.
 *   7 items, 3 days → sizes [3, 2, 2]
 *   2 items, 4 days → sizes [1, 1, 0, 0]
 * Keeps the items in order.
 *
 * Hints:
 *   - Math.floor(items.length / dayCount) is the base size.
 *   - items.length % dayCount of the days get one extra.
 *   - items.slice(start, end) takes a group without changing `items`.
 *
 * @template T
 * @param {T[]} items
 * @param {number} dayCount
 * @returns {T[][]}
 */
export function splitIntoDays(items, dayCount) {
  throw new Error('TODO: splitIntoDays');
}

// ─── Glue (written for you) ─────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array<{ id: string, priority: 'must' | 'nice' }>} input.requirements
 * @param {Array<{ id: string, requirement_ids: string[], category: string, difficulty: number }>} input.questions
 * @param {number} input.days  number of days before the interview
 * @returns {{ days_available: number, days: Array<{ day: number, focus: string, question_ids: string[], minutes: number }> }}
 */
export function buildSchedule({ requirements, questions, days }) {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`days must be a positive integer, got ${days}`);
  }

  const requirementsById = new Map(requirements.map((r) => [r.id, r]));
  const ordered = sortForSchedule(questions, requirementsById);

  // With 3+ days the last one is kept for review, so the night before the
  // interview is revision rather than new material.
  const learningDays = days >= 3 ? days - 1 : days;
  const groups = splitIntoDays(ordered, learningDays);
  while (groups.length < days) groups.push([]);

  const reviewPool = ordered.filter((q) => isMustHave(q, requirementsById));
  const review = reviewPool.length ? reviewPool : ordered;
  let reviewCursor = 0;

  const scheduleDays = groups.map((group, index) => {
    const day = index + 1;
    if (group.length) {
      return {
        day,
        focus: focusFor(group),
        question_ids: group.map((q) => q.id),
        minutes: sumCost(group),
      };
    }
    if (!review.length) {
      return {
        day,
        focus: 'Company research and role review',
        question_ids: [],
        minutes: EMPTY_KIT_MINUTES,
      };
    }
    // Cycle through the review pool so consecutive review days differ.
    const picked = [];
    for (let i = 0; i < Math.min(REVIEW_QUESTIONS_PER_DAY, review.length); i++) {
      picked.push(review[reviewCursor % review.length]);
      reviewCursor++;
    }
    return {
      day,
      focus: reviewPool.length ? 'Review: must-have questions' : 'Review',
      question_ids: picked.map((q) => q.id),
      minutes: sumCost(picked),
    };
  });

  return { days_available: days, days: scheduleDays };
}

export function isMustHave(question, requirementsById) {
  return question.requirement_ids.some((id) => requirementsById.get(id)?.priority === 'must');
}

function sumCost(questions) {
  return questions.reduce((total, q) => total + questionCost(q), 0);
}

// "Technical + Behavioural": the categories covered that day, in order.
function focusFor(questions) {
  const categories = [...new Set(questions.map((q) => q.category))];
  return categories.map((c) => c.charAt(0).toUpperCase() + c.slice(1).replace('-', ' ')).join(' + ');
}
