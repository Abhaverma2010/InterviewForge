// Question generation: one model call per category, each with its own
// instructions and only the requirements that belong to it. Technical
// requirements get technical questions; behavioural ones get STAR-style
// questions; system design is only asked for when the role or the company's
// published process calls for it.
//
// Code, not the model, decides which categories run, which requirement ids a
// question may cite, and the difficulty range.

import { z } from 'zod';
import { UNTRUSTED_RULES } from './untrusted.js';

export const CATEGORY_FOR_KIND = {
  technical: 'technical',
  domain: 'technical',
  behavioural: 'behavioural',
};

const questionListSchema = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).default([]),
        prompt: z.string().min(1),
        answer_outline: z.string().default(''),
        difficulty: z.coerce.number().default(2),
      }),
    )
    .default([]),
});

const OUTPUT_FORMAT = `Return JSON:
{
  "questions": [
    {
      "requirement_ids": string[],  // ids from the list below that this question tests
      "prompt": string,             // the question, as the interviewer would ask it
      "answer_outline": string,     // 3-6 short bullet points of what a strong answer covers
      "difficulty": 1 | 2 | 3       // 1 = warm-up, 2 = standard, 3 = hard for this seniority
    }
  ]
}`;

const CATEGORY_INSTRUCTIONS = {
  technical: `You write technical interview questions.
- Test each requirement listed. Mix concept questions, practical scenarios, debugging and
  trade-off questions; avoid trivia.
- Calibrate difficulty to the seniority.
- If the company's process includes a take-home, live coding or pair programming, include
  questions in that style (e.g. "walk through how you would structure...").`,

  behavioural: `You write behavioural interview questions answered with the STAR method
(Situation, Task, Action, Result).
- Each question targets one listed requirement, such as communication, mentoring or ownership.
- The answer outline says what a strong story demonstrates and what interviewers listen for.
- If no requirements are listed, write general questions about collaboration and handling
  difficulty, with empty requirement_ids.`,

  'system-design': `You write system design interview questions.
- Pose design problems relevant to the company's product and the role's technologies.
- The answer outline covers: clarifying requirements, main components, data model,
  scaling and failure handling, and the key trade-offs.
- Cite the technical requirements each design exercises.`,

  'company-fit': `You write "company fit" interview questions: motivation, values, and how the
candidate would work in this company's way of working.
- Base them only on the company facts provided. If few facts are known, keep questions
  general rather than inventing details about the company.
- Cite a requirement id only when the question genuinely tests it (e.g. domain knowledge).`,
};

/**
 * @param {object} input
 * @param {'technical' | 'behavioural' | 'system-design' | 'company-fit'} input.category
 * @param {Array<{ id: string, text: string, priority: string }>} input.requirements
 *   requirements this call may cite
 * @param {number} input.count  how many questions to ask for
 * @param {object} input.context  role, company brief and hiring process
 * @param {boolean} [input.gapFill]  one question per requirement, for the coverage pass
 * @param {{ llm: { chatJson: Function } }} deps
 */
export async function generateQuestions(
  { category, requirements, count, context, gapFill = false },
  { llm },
) {
  const instructions = [
    CATEGORY_INSTRUCTIONS[category],
    gapFill
      ? `- These requirements have no questions yet. Write exactly one question for EACH
  requirement listed, citing that requirement's id.`
      : `- Write about ${count} questions. Every listed requirement must be cited by at least one.`,
  ].join('\n');

  const result = await llm.chatJson({
    system: `${instructions}\n\n${UNTRUSTED_RULES}\n\n${OUTPUT_FORMAT}`,
    user: describeContext(context, requirements, category),
    schema: questionListSchema,
    temperature: 0.5,
  });

  return cleanQuestions(result.questions, { category, requirements });
}

/**
 * Keeps only what the model is allowed to say: cited ids must be ones we
 * offered, difficulty is an integer 1-3, duplicates are removed. Technical and
 * system-design questions that cite nothing valid are dropped.
 */
export function cleanQuestions(questions, { category, requirements }) {
  const allowed = new Set(requirements.map((r) => r.id));
  const needsRequirement = category === 'technical' || category === 'system-design';
  const seen = new Set();
  const cleaned = [];

  for (const q of questions) {
    const requirementIds = [...new Set(q.requirement_ids.filter((id) => allowed.has(id)))];
    if (needsRequirement && requirementIds.length === 0) continue;

    const key = q.prompt.toLowerCase().replace(/\W+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);

    cleaned.push({
      requirement_ids: requirementIds,
      category,
      prompt: q.prompt.trim(),
      answer_outline: q.answer_outline.trim(),
      difficulty: Math.min(3, Math.max(1, Math.round(Number(q.difficulty) || 2))),
    });
  }
  return cleaned;
}

/**
 * Last resort for a must-have requirement the model would not cover: a plain
 * question written by code, so the kit never ships with an uncovered must-have.
 */
export function templateQuestion(requirement) {
  const byKind = {
    technical: {
      category: 'technical',
      prompt: `Walk me through your experience with ${requirement.text}. Describe a real problem you solved with it and the trade-offs you made.`,
      answer_outline:
        '- Concrete project and your role\n- The problem and constraints\n- What you built and why\n- Trade-offs and alternatives considered\n- Outcome and what you would change',
    },
    domain: {
      category: 'technical',
      prompt: `What do you know about ${requirement.text}, and how have you applied that knowledge in your work?`,
      answer_outline:
        '- Key concepts of the domain\n- Where you applied them\n- Pitfalls you have seen\n- How it shapes technical decisions',
    },
    behavioural: {
      category: 'behavioural',
      prompt: `Tell me about a time you demonstrated this: ${requirement.text}.`,
      answer_outline:
        '- Situation: context and stakes\n- Task: your responsibility\n- Action: what you did, specifically\n- Result: measurable outcome and what you learned',
    },
  };
  const template = byKind[requirement.kind] ?? byKind.technical;
  return { requirement_ids: [requirement.id], difficulty: 2, ...template };
}

function describeContext(context, requirements, category) {
  const { role, brief, hiringProcess } = context;
  const lines = [
    `Role: ${role.title ?? 'not stated'} (seniority: ${role.seniority ?? 'not stated'})`,
    `Company: ${context.company}`,
  ];
  if (role.responsibilities?.length) {
    lines.push(`Responsibilities: ${role.responsibilities.slice(0, 8).join('; ')}`);
  }
  if (category === 'company-fit' || category === 'system-design') {
    lines.push(
      brief.found
        ? `What the company does: ${brief.what_they_do}\nAbout the company: ${brief.summary}`
        : 'Little is known about the company.',
    );
  }
  if (hiringProcess.found) {
    const stages = hiringProcess.stages.map((s) => `${s.name} (${s.type})`).join(', ');
    lines.push(`The company's interview stages: ${stages}`);
  }
  lines.push(
    '',
    'Requirements you may cite:',
    ...(requirements.length
      ? requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`)
      : ['(none)']),
  );
  return lines.join('\n');
}
