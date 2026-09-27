// Practice mode ordering: Leitner boxes.
//
// Each flashcard sits in a box from 1 (shaky) to 5 (solid). Rating a card
// moves it: "again" back to box 1, "hard" down one, "good" up one, "easy" up
// two. The next session starts with what the user was least confident about.
//
// Why Leitner rather than a full spaced-repetition algorithm (SM-2)? Interview
// prep runs over days, not months, so long review intervals never come into
// play; what matters is "show me my weakest cards first", which boxes express
// directly and which a user can understand at a glance.

export const RATINGS = ['again', 'hard', 'good', 'easy'];
const MIN_BOX = 1;
const MAX_BOX = 5;

/**
 * @typedef {object} CardProgress
 * @property {number} box  1-5
 * @property {string} last_rating
 * @property {string} last_reviewed_at  ISO date
 * @property {number} reviews
 */

/**
 * Records one rating and returns the card's new progress.
 * @param {CardProgress | undefined} progress
 * @param {'again' | 'hard' | 'good' | 'easy'} rating
 * @param {Date} [at]
 * @returns {CardProgress}
 */
export function rateCard(progress, rating, at = new Date()) {
  if (!RATINGS.includes(rating))
    throw new RangeError(`rating must be one of ${RATINGS.join(', ')}`);
  const box = progress?.box ?? MIN_BOX;
  const moved = { again: MIN_BOX, hard: box - 1, good: box + 1, easy: box + 2 }[rating];
  return {
    box: Math.min(MAX_BOX, Math.max(MIN_BOX, moved)),
    last_rating: rating,
    last_reviewed_at: at.toISOString(),
    reviews: (progress?.reviews ?? 0) + 1,
  };
}

/**
 * The order for the next session: cards last rated "again" first, then cards
 * never seen, then the rest by box (lowest first); ties go to the card
 * reviewed longest ago.
 *
 * @param {Array<{ id: string }>} flashcards
 * @param {Record<string, CardProgress>} progressById
 * @returns {string[]} flashcard ids
 */
export function nextSessionOrder(flashcards, progressById = {}) {
  const rank = (card) => {
    const p = progressById[card.id];
    if (!p) return { group: 1, box: MIN_BOX, at: '' };
    return { group: p.last_rating === 'again' ? 0 : 2, box: p.box, at: p.last_reviewed_at };
  };
  return flashcards
    .map((card, index) => ({ card, index, ...rank(card) }))
    .sort(
      (a, b) => a.group - b.group || a.box - b.box || a.at.localeCompare(b.at) || a.index - b.index,
    )
    .map((entry) => entry.card.id);
}

/**
 * What has been covered, overall and per requirement. A requirement's
 * confidence is the average box of its cards (unseen cards count as 0), so
 * the UI can show which requirements are weakest.
 */
export function practiceSummary(kit, progressById = {}) {
  const cards = kit.flashcards;
  const reviewed = cards.filter((c) => progressById[c.id]);
  const mastered = reviewed.filter((c) => progressById[c.id].box >= 4);

  const byRequirement = kit.role.requirements.map((r) => {
    const own = cards.filter((c) => c.requirement_ids.includes(r.id));
    const boxes = own.map((c) => progressById[c.id]?.box ?? 0);
    return {
      requirement_id: r.id,
      text: r.text,
      priority: r.priority,
      cards: own.length,
      reviewed: own.filter((c) => progressById[c.id]).length,
      confidence: boxes.length ? round1(boxes.reduce((a, b) => a + b, 0) / boxes.length) : null,
    };
  });

  return {
    total: cards.length,
    reviewed: reviewed.length,
    not_reviewed: cards.length - reviewed.length,
    mastered: mastered.length,
    by_requirement: byRequirement,
    weakest: byRequirement
      .filter((r) => r.confidence !== null)
      .sort((a, b) => a.confidence - b.confidence || (a.priority === 'must' ? -1 : 1))
      .slice(0, 3)
      .map((r) => r.requirement_id),
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
