// Story bank: the few real stories a candidate tells, mapped onto the many
// behavioural questions they may be asked.
//
// The problem it solves: interviews ask a dozen "tell me about a time..."
// questions, but most people have four or five good stories. What they need
// to know the night before is which story answers which question, which
// questions they have no story for, and which story they are leaning on too
// much. That mapping is deterministic, so code does it:
//   - a story fits a question if the user linked them directly, or if they
//     share a requirement (a story tagged "mentoring" fits every question
//     that tests mentoring)
//   - story questions are behavioural and company-fit questions, plus any
//     question phrased as "tell me about a time..."

export const OVERUSE_THRESHOLD = 4;

const STORY_PHRASING =
  /\b(tell me about|describe|give (me )?an example|share)\b.{0,40}\b(time|situation|occasion|moment)\b/i;

/** Questions that are answered with a story. */
export function isStoryQuestion(question) {
  return (
    question.category === 'behavioural' ||
    question.category === 'company-fit' ||
    STORY_PHRASING.test(question.prompt)
  );
}

/**
 * @param {object} kit
 * @returns {{
 *   questions: Array<{ question_id: string, story_ids: string[], via: Record<string, 'linked' | 'requirement'> }>,
 *   unanswered: string[],
 *   overused: Array<{ story_id: string, count: number }>,
 *   unused: string[],
 *   requirementsWithoutStory: string[],
 *   covered: number,
 *   total: number,
 * }}
 */
export function analyseStoryBank(kit) {
  const stories = kit.stories ?? [];
  const storyQuestions = kit.questions.filter(isStoryQuestion);

  const questions = storyQuestions.map((q) => {
    const via = {};
    for (const story of stories) {
      if (story.question_ids.includes(q.id)) via[story.id] = 'linked';
      else if (story.requirement_ids.some((rid) => q.requirement_ids.includes(rid)))
        via[story.id] = 'requirement';
    }
    // Direct links first: the user chose them.
    const storyIds = Object.keys(via).sort((a, b) =>
      via[a] === via[b] ? 0 : via[a] === 'linked' ? -1 : 1,
    );
    return { question_id: q.id, story_ids: storyIds, via };
  });

  const uses = new Map(stories.map((s) => [s.id, 0]));
  for (const entry of questions)
    for (const sid of entry.story_ids) uses.set(sid, uses.get(sid) + 1);

  // Behavioural requirements no story demonstrates yet.
  const tagged = new Set(stories.flatMap((s) => s.requirement_ids));
  const requirementsWithoutStory = kit.role.requirements
    .filter((r) => r.kind === 'behavioural' && !tagged.has(r.id))
    .map((r) => r.id);

  const answered = questions.filter((q) => q.story_ids.length);
  return {
    questions,
    unanswered: questions.filter((q) => !q.story_ids.length).map((q) => q.question_id),
    overused: [...uses]
      .filter(([, count]) => count >= OVERUSE_THRESHOLD)
      .map(([story_id, count]) => ({ story_id, count }))
      .sort((a, b) => b.count - a.count),
    unused: [...uses].filter(([, count]) => count === 0).map(([id]) => id),
    requirementsWithoutStory,
    covered: answered.length,
    total: questions.length,
  };
}
