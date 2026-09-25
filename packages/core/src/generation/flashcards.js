// Flashcards: short recall cards for the requirements, generated in one call
// once the questions exist. If the call fails, cards are derived from the
// questions by code so the kit still has something to practise with.

import { z } from 'zod';
import { UNTRUSTED_RULES } from './untrusted.js';

const flashcardSchema = z.object({
  flashcards: z
    .array(
      z.object({
        front: z.string().min(1),
        back: z.string().min(1),
        requirement_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

const PROMPT = `You write flashcards for interview preparation.
- Each card tests one fact, concept or talking point a candidate should recall quickly.
- Front: a short question or cue. Back: a concise answer (1-3 sentences or a few bullets).
- Cover every requirement listed, must-have ones with 2 cards each where useful.
- Cite the requirement ids each card supports.

${UNTRUSTED_RULES}

Return JSON: { "flashcards": [ { "front": string, "back": string, "requirement_ids": string[] } ] }`;

export async function generateFlashcards({ requirements, questions, role }, { llm }) {
  if (!requirements.length) return flashcardsFromQuestions(questions);

  const user = [
    `Role: ${role.title ?? 'not stated'}`,
    'Requirements:',
    ...requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`),
    '',
    'Interview questions already in the kit (for context):',
    ...questions.slice(0, 20).map((q) => `- ${q.prompt}`),
  ].join('\n');

  const result = await llm.chatJson({
    system: PROMPT,
    user,
    schema: flashcardSchema,
    temperature: 0.3,
  });
  const allowed = new Set(requirements.map((r) => r.id));
  const cards = result.flashcards
    .map((c) => ({
      front: c.front.trim(),
      back: c.back.trim(),
      requirement_ids: [...new Set(c.requirement_ids.filter((id) => allowed.has(id)))],
    }))
    .filter((c) => c.front && c.back);
  return cards.length ? cards : flashcardsFromQuestions(questions);
}

/** One card per question: the prompt on the front, the answer outline on the back. */
export function flashcardsFromQuestions(questions) {
  return questions
    .filter((q) => q.answer_outline)
    .map((q) => ({ front: q.prompt, back: q.answer_outline, requirement_ids: q.requirement_ids }));
}
