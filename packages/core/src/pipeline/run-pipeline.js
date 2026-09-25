// The full kit pipeline. The API and `npm run evaluate` both call this, so
// there is exactly one implementation.
//
//   1. extract     job description → role + requirements (model, then verified by code)
//   2. crawl       company site → pages, best hiring/about page (code)
//   3. discussion  public interview discussion (API search, code)
//   4. brief       company brief from home/about pages (model, only if pages exist)
//   5. hiring      interview stages from hiring page + discussion (model, only if found)
//   6. questions   one call per category, categories chosen by code (model)
//   7. coverage    code finds uncovered requirements → targeted questions → check again
//   8. flashcards  (model, with a code fallback)
//   9. schedule    allocation across the requested days (code)
//  10. validate    the kit against Appendix A (code)
//
// Only step 1 is fatal: without the requirements there is no kit. Every other
// failure is recorded in meta.warnings and the kit is built from what is left.

import { findCoverageGaps } from '../coverage/coverage.js';
import { extractRequirements } from '../extraction/requirements.js';
import { buildCompanyBrief, extractHiringProcess } from '../generation/company-research.js';
import { flashcardsFromQuestions, generateFlashcards } from '../generation/flashcards.js';
import { CATEGORY_FOR_KIND, generateQuestions, templateQuestion } from '../generation/questions.js';
import { guessCompanyName } from '../retrieval/company-name.js';
import { crawlCompany } from '../retrieval/crawler.js';
import { searchPublicDiscussion } from '../retrieval/discussion.js';
import { buildSchedule } from '../scheduling/schedule.js';
import { validateKit } from '../validation/kit-schema.js';

export const MAX_COVERAGE_PASSES = 3;
export const MAX_DAYS = 365;
export const MAX_JD_CHARS = 50_000;

export class PipelineError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message, { cause });
    this.name = 'PipelineError';
    this.code = code;
    this.details = details;
  }
}

/** Checks one case's input. Returns a list of problems (empty when valid). */
export function validatePipelineInput({ jd, companyUrl, days }) {
  const problems = [];
  if (typeof jd !== 'string' || !jd.trim()) problems.push('jd must be a non-empty string');
  else if (jd.length > MAX_JD_CHARS) problems.push(`jd must be at most ${MAX_JD_CHARS} characters`);
  if (typeof companyUrl !== 'string' || !companyUrl.trim()) {
    problems.push('company_url must be a non-empty string');
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    problems.push(`days must be an integer from 1 to ${MAX_DAYS}`);
  }
  return problems;
}

/**
 * @param {{ jd: string, companyUrl: string, days: number }} input
 * @param {object} deps
 * @param {{ chatJson: Function }} deps.llm
 * @param {{ fetcher: object, robots: object }} deps.crawler
 * @param {() => Date} [deps.now]
 * @param {object} [opts]
 * @param {(event: { step: string, status: string, detail?: string }) => void} [opts.onProgress]
 * @returns {Promise<object>} the kit
 */
export async function runPipeline(input, deps, { onProgress = () => {}, crawlOptions } = {}) {
  const problems = validatePipelineInput(input);
  if (problems.length) {
    throw new PipelineError('INVALID_INPUT', problems.join('; '), { details: problems });
  }
  const { jd, companyUrl, days } = input;
  const { llm, crawler, now = () => new Date() } = deps;
  const warnings = [];
  const steps = [];

  // Runs one step, timing it and reporting progress. Non-fatal steps return
  // `fallback` on failure and record a warning.
  async function step(name, fn, { fatal = false, fallback } = {}) {
    const started = Date.now();
    onProgress({ step: name, status: 'started' });
    try {
      const value = await fn();
      steps.push({ step: name, status: 'done', ms: Date.now() - started });
      onProgress({ step: name, status: 'done' });
      return value;
    } catch (err) {
      steps.push({ step: name, status: 'failed', ms: Date.now() - started, error: errorInfo(err) });
      onProgress({ step: name, status: 'failed', detail: err.message });
      if (fatal) {
        throw new PipelineError(err.code ?? 'STEP_FAILED', `${name} failed: ${err.message}`, {
          cause: err,
        });
      }
      warnings.push(`${name} failed (${err.code ?? 'error'}): ${err.message}`);
      return typeof fallback === 'function' ? fallback(err) : fallback;
    }
  }

  // 1. Requirements. Fatal: nothing else makes sense without them.
  const role = await step('extract', () => extractRequirements(jd, { llm }), { fatal: true });

  // 2-3. Research. These never throw for a bad site; failures come back as data.
  const crawl = await step('crawl', () => crawlCompany(companyUrl, crawler, crawlOptions));
  const home = crawl.pages.find((p) => p.kind === 'home');
  const company = guessCompanyName({
    fromJd: role.company,
    siteName: home?.siteName,
    title: home?.title,
    url: companyUrl,
  });
  const discussion = await step('discussion', () => searchPublicDiscussion(company, crawler), {
    fallback: { query: '', source: '', results: [], error: null },
  });

  // 4-5. What the research means. Each runs only if there is material.
  const brief = await step('brief', () => buildCompanyBrief({ company, crawl }, { llm }), {
    fallback: () => ({
      summary: `A company brief for ${company} could not be generated. See the sources below.`,
      what_they_do: 'Unknown.',
      sources: [],
      found: false,
    }),
  });
  const hiringProcess = await step(
    'hiring-process',
    () => extractHiringProcess({ company, crawl, discussion }, { llm }),
    { fallback: { found: false, stages: [], notes: [], sources: [] } },
  );

  // 6. Questions, one call per category.
  const context = { company, role, brief, hiringProcess };
  const questions = [];
  for (const plan of planCategories(role, brief, hiringProcess)) {
    const generated = await step(
      `questions:${plan.category}`,
      () => generateQuestions({ ...plan, context }, { llm }),
      { fallback: [] },
    );
    questions.push(...generated.map((q) => ({ ...q, origin: 'generated' })));
  }

  // 7. Coverage: check, fill the gaps, check again.
  const coverage = await step('coverage', () =>
    closeCoverageGaps({ role, questions, context, llm, step }),
  );

  // 8. Flashcards.
  const flashcards = await step(
    'flashcards',
    () => generateFlashcards({ requirements: role.requirements, questions, role }, { llm }),
    { fallback: () => flashcardsFromQuestions(questions) },
  );

  // 9-10. Assemble, schedule, validate.
  const kit = assembleKit({
    jd,
    companyUrl,
    days,
    company,
    role,
    crawl,
    discussion,
    brief,
    hiringProcess,
    questions,
    flashcards,
    coverage,
    warnings,
    steps,
    researchedAt: now().toISOString(),
  });

  const check = validateKit(kit);
  if (!check.ok) {
    throw new PipelineError('INVALID_KIT', `Generated kit failed validation: ${check.errors[0]}`, {
      details: check.errors,
    });
  }
  onProgress({ step: 'complete', status: 'done' });
  return kit;
}

/**
 * Which question categories to generate, with which requirements and how many.
 * Decided by code from what extraction and research found.
 */
export function planCategories(role, brief, hiringProcess) {
  const reqs = role.requirements;
  const technical = reqs.filter((r) => CATEGORY_FOR_KIND[r.kind] === 'technical');
  const behavioural = reqs.filter((r) => r.kind === 'behavioural');
  const domain = reqs.filter((r) => r.kind === 'domain');
  const plans = [];

  if (technical.length) {
    plans.push({
      category: 'technical',
      requirements: technical,
      count: clamp(Math.ceil(technical.length * 1.5), 3, 10),
    });
  }
  if (needsSystemDesign(role, hiringProcess) && technical.length) {
    plans.push({ category: 'system-design', requirements: technical, count: 2 });
  }
  plans.push({
    category: 'behavioural',
    requirements: behavioural,
    count: behavioural.length ? clamp(behavioural.length + 1, 2, 5) : 2,
  });
  plans.push({ category: 'company-fit', requirements: domain, count: brief.found ? 3 : 2 });
  return plans;
}

export function needsSystemDesign(role, hiringProcess) {
  if (hiringProcess.stages?.some((s) => s.type === 'system-design')) return true;
  if (
    /\b(senior|staff|lead|principal|architect)\b/i.test(
      `${role.seniority ?? ''} ${role.title ?? ''}`,
    )
  ) {
    return true;
  }
  const text = [...role.requirements.map((r) => r.text), ...role.responsibilities].join(' ');
  return /\b(architect\w*|system design|distributed|scal(e|able|ability|ing))\b/i.test(text);
}

/**
 * The second pass. Pass 1 checks the first draft; each later pass asks for
 * questions aimed only at the uncovered requirements and checks again.
 * Stops when nothing is uncovered or after MAX_COVERAGE_PASSES checks. Any
 * must-have still uncovered then gets a template question written by code,
 * so the kit never ships with an uncovered must-have. (Mutates `questions`.)
 */
async function closeCoverageGaps({ role, questions, context, llm, step }) {
  const history = [];
  let passes = 0;
  let gaps;

  for (;;) {
    passes += 1;
    gaps = findCoverageGaps(role.requirements, questions);
    history.push({ pass: passes, uncovered_requirement_ids: gaps.uncovered });
    if (!gaps.uncovered.length || passes >= MAX_COVERAGE_PASSES) break;

    const missing = role.requirements.filter((r) => gaps.uncovered.includes(r.id));
    for (const category of ['technical', 'behavioural']) {
      const group = missing.filter((r) => CATEGORY_FOR_KIND[r.kind] === category);
      if (!group.length) continue;
      const filled = await step(
        `coverage-pass-${passes + 1}:${category}`,
        () =>
          generateQuestions(
            { category, requirements: group, count: group.length, context, gapFill: true },
            { llm },
          ),
        { fallback: [] },
      );
      questions.push(
        ...filled.map((q) => ({ ...q, origin: 'generated', coverage_pass: passes + 1 })),
      );
    }
  }

  const templated = [];
  for (const id of gaps.uncoveredMust) {
    const requirement = role.requirements.find((r) => r.id === id);
    questions.push({ ...templateQuestion(requirement), origin: 'template' });
    templated.push(id);
  }

  const final = findCoverageGaps(role.requirements, questions);
  return {
    uncovered_requirement_ids: final.uncovered,
    passes,
    template_filled_requirement_ids: templated,
    history,
  };
}

function assembleKit({
  jd,
  companyUrl,
  days,
  company,
  role,
  crawl,
  discussion,
  brief,
  hiringProcess,
  questions,
  flashcards,
  coverage,
  warnings,
  steps,
  researchedAt,
}) {
  const kitQuestions = questions.map((q, i) => ({
    id: `q${i + 1}`,
    requirement_ids: q.requirement_ids,
    category: q.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
    // Builder state (extension): see README, "generated, edited and pinned".
    origin: q.origin,
    edited: false,
    pinned: false,
  }));
  const kitFlashcards = flashcards.map((f, i) => ({
    id: `f${i + 1}`,
    front: f.front,
    back: f.back,
    requirement_ids: f.requirement_ids,
    origin: 'generated',
    edited: false,
    pinned: false,
  }));

  const pagesUsed = [...new Set([...brief.sources, ...hiringProcess.sources])].filter(
    (url) => !url.startsWith('https://news.ycombinator.com/'),
  );
  if (!crawl.reachable) {
    warnings.push(
      `Company site unreachable: ${crawl.error?.code} ${crawl.error?.message ?? ''}`.trim(),
    );
  }

  return {
    source: {
      company,
      company_url: companyUrl,
      role: role.title ?? 'Not stated',
      location: role.location ?? 'Not stated',
      jd_chars: jd.length,
      researched_at: researchedAt,
      pages_used: pagesUsed,
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
      found: brief.found,
      hiring_process: hiringProcess,
      research: {
        site_reachable: crawl.reachable,
        site_error: crawl.error,
        hiring_page: crawl.hiringPage,
        about_page: crawl.aboutPage,
        pages_crawled: crawl.pages.map((p) => ({ url: p.url, kind: p.kind })),
        skipped_sources: crawl.skipped,
        discussion: {
          query: discussion.query,
          source: discussion.source,
          error: discussion.error,
          results: discussion.results.map(({ url, title }) => ({ url, title })),
        },
      },
    },
    role: {
      title: role.title ?? 'Not stated',
      seniority: role.seniority ?? 'Not stated',
      responsibilities: role.responsibilities,
      requirements: role.requirements,
      thin: role.thin,
      notes: role.notes,
      dropped_requirements: role.dropped,
    },
    questions: kitQuestions,
    flashcards: kitFlashcards,
    schedule: buildSchedule({ requirements: role.requirements, questions: kitQuestions, days }),
    coverage,
    meta: { warnings, steps },
  };
}

function errorInfo(err) {
  return { code: err.code ?? 'ERROR', message: err.message };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
