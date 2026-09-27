// Labels and small formatting helpers shared by the pages.

export const CATEGORIES = ['technical', 'system-design', 'behavioural', 'company-fit'];

export const CATEGORY_LABELS = {
  technical: 'Technical',
  'system-design': 'System design',
  behavioural: 'Behavioural',
  'company-fit': 'Company fit',
};

export const CATEGORY_HINTS = {
  technical: 'Skills and tools named in the posting.',
  'system-design': 'Design exercises, asked for senior roles or when the company runs a design round.',
  behavioural: 'Answer with a story: situation, task, action, result.',
  'company-fit': 'Motivation and how you would work at this company.',
};

export const DIFFICULTY_LABELS = { 1: 'Warm-up', 2: 'Standard', 3: 'Hard' };

// The phases a generation goes through, in order, with a plain-language label.
export const PHASES = [
  { key: 'extract', label: 'Reading the job description' },
  { key: 'crawl', label: 'Crawling the company website' },
  { key: 'discussion', label: 'Searching public interview discussion' },
  { key: 'brief', label: 'Writing the company brief' },
  { key: 'hiring-process', label: 'Working out the interview process' },
  { key: 'questions', label: 'Writing questions, one category at a time' },
  { key: 'coverage', label: 'Checking every requirement has a question' },
  { key: 'flashcards', label: 'Making flashcards' },
];

/** Which phase a pipeline step belongs to ("questions:technical" → "questions"). */
export function phaseOf(step) {
  if (step.startsWith('questions:')) return 'questions';
  if (step.startsWith('coverage')) return 'coverage';
  return step;
}

export function stepLabel(step) {
  if (step.startsWith('questions:')) return `${CATEGORY_LABELS[step.split(':')[1]] ?? step} questions`;
  const pass = step.match(/^coverage-pass-(\d+):(.+)$/);
  if (pass) return `Gap-filling pass ${pass[1]}: ${CATEGORY_LABELS[pass[2]] ?? pass[2]}`;
  return PHASES.find((p) => p.key === step)?.label ?? step;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Requirement ids that no question in `questions` cites. */
export function uncoveredRequirements(requirements, questions) {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements.filter((r) => !covered.has(r.id));
}
