// Coverage checking: which requirements have no question against them.
// Plain set arithmetic, deliberately not a model's judgement: the brief
// requires the gap decision to be made by our code.

/**
 * @param {Array<{ id: string, priority: 'must' | 'nice' }>} requirements
 * @param {Array<{ requirement_ids: string[] }>} questions
 * @returns {{ uncovered: string[], uncoveredMust: string[], uncoveredNice: string[] }}
 *   requirement ids, in requirement order
 */
export function findCoverageGaps(requirements, questions) {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  const uncovered = requirements.filter((r) => !covered.has(r.id));
  return {
    uncovered: uncovered.map((r) => r.id),
    uncoveredMust: uncovered.filter((r) => r.priority === 'must').map((r) => r.id),
    uncoveredNice: uncovered.filter((r) => r.priority === 'nice').map((r) => r.id),
  };
}
