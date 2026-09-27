// Hand-written demo kits, so the app can be explored without spending any
// LLM quota. Each is assembled with the same schedule and coverage code as a
// generated kit and validated against the Appendix A structure.

import { buildSchedule, findCoverageGaps, validateKit } from '@interviewforge/core';

const RESEARCHED_AT = '2026-09-20T10:00:00.000Z';

// ─── 1. Senior backend role: the full experience ─────────────────────────────

const PAYMENTS_JD = `Senior Backend Engineer — Ledgerly (Payments Platform)
Location: Remote (Europe)

About the role
Ledgerly moves money for 4,000 online businesses. You will join the Payments Core team that owns our ledger and payout services.

What you'll do
- Design and run the services that record every payment in our double-entry ledger
- Improve the reliability of payouts across 30 countries
- Mentor two mid-level engineers and review designs across teams

Requirements
- 5+ years building backend services in Go or Java
- Strong PostgreSQL skills, including schema design and query tuning
- Experience designing idempotent, fault-tolerant APIs
- Experience with event streaming (Kafka or similar)
- Clear written communication; we write design docs for every change
- Experience mentoring other engineers

Nice to have
- Background in payments or fintech
- Kubernetes experience`;

function paymentsKit() {
  const requirements = [
    req('r1', '5+ years building backend services in Go or Java', 'technical', 'must'),
    req(
      'r2',
      'Strong PostgreSQL skills, including schema design and query tuning',
      'technical',
      'must',
    ),
    req('r3', 'Designing idempotent, fault-tolerant APIs', 'technical', 'must'),
    req('r4', 'Event streaming (Kafka or similar)', 'technical', 'must'),
    req('r5', 'Clear written communication', 'behavioural', 'must'),
    req('r6', 'Mentoring other engineers', 'behavioural', 'must'),
    req('r7', 'Background in payments or fintech', 'domain', 'nice'),
    req('r8', 'Kubernetes experience', 'technical', 'nice'),
  ];

  const questions = [
    q(
      'technical',
      ['r3'],
      3,
      'A client retries a "create payment" request after a timeout. How do you make sure the customer is charged exactly once?',
      '- Idempotency key supplied by the client, stored with a unique constraint\n- Return the stored result for a repeated key instead of re-executing\n- Key scope and expiry; what happens if the first request is still in flight\n- Distinguish safe retries from genuinely new requests\n- Test with injected timeouts',
    ),
    q(
      'technical',
      ['r2'],
      2,
      'A ledger query that used to take 20 ms now takes 4 seconds. Walk me through how you find and fix the cause.',
      '- Reproduce with EXPLAIN (ANALYZE, BUFFERS)\n- Look for sequential scans, bad row estimates, bloated indexes\n- Check for changed data distribution or stale statistics (ANALYZE)\n- Consider a composite or partial index; verify with the plan\n- Watch for lock contention with pg_stat_activity',
    ),
    q(
      'technical',
      ['r1'],
      2,
      'In Go (or Java), how do you structure a service so that a slow downstream dependency cannot exhaust its resources?',
      '- Timeouts on every outbound call (context deadlines)\n- Bounded worker pools / connection pools\n- Circuit breaker and fast failure\n- Bulkheads between unrelated dependencies\n- Metrics to spot saturation early',
    ),
    q(
      'technical',
      ['r4'],
      2,
      'How do you guarantee that a payout event published to Kafka is processed once, even if a consumer crashes mid-way?',
      '- At-least-once delivery is the realistic baseline\n- Make consumers idempotent (dedupe on event id)\n- Commit offsets only after the side effect is durable\n- Transactional outbox for publishing from the database\n- Dead-letter topic for poison messages',
    ),
    q(
      'technical',
      ['r2', 'r3'],
      3,
      'Design the table schema for a double-entry ledger. How do you guarantee every transaction balances?',
      '- Accounts, transactions and entries tables\n- Entries are immutable; corrections are new entries\n- Sum of entries per transaction must be zero: enforce in a transaction, optionally a deferred constraint\n- Use integer minor units, never floats\n- Index for balance queries; consider balance snapshots',
    ),
    q(
      'technical',
      ['r8'],
      1,
      'What does a Kubernetes readiness probe do, and how is it different from a liveness probe?',
      '- Readiness: whether the pod should receive traffic\n- Liveness: whether the container should be restarted\n- Misconfigured liveness probes cause restart loops under load\n- Readiness should reflect dependencies the pod truly needs',
    ),
    q(
      'system-design',
      ['r3', 'r4'],
      3,
      'Design a payout system that sends money to sellers in 30 countries through different banking partners.',
      '- Clarify volumes, latency needs and failure modes\n- Payout state machine persisted in PostgreSQL\n- Partner adapters behind a common interface\n- Idempotent partner calls, reconciliation jobs for unknown outcomes\n- Events for status changes; retries with backoff; manual review queue',
    ),
    q(
      'system-design',
      ['r2', 'r1'],
      3,
      'The ledger database is approaching the limits of a single PostgreSQL primary. What are your options?',
      '- Measure first: which resource is saturated\n- Read replicas for reporting queries\n- Partition large tables by time\n- Archive cold data\n- Shard by merchant as a last resort, and what that costs',
    ),
    q(
      'behavioural',
      ['r5'],
      2,
      'Tell me about a design document you wrote that changed the direction of a project.',
      '- Situation: what decision was at stake\n- Task: why a written document was the right tool\n- Action: structure, alternatives considered, how you gathered feedback\n- Result: the decision made and its outcome',
    ),
    q(
      'behavioural',
      ['r6'],
      2,
      'Tell me about a time you helped a less experienced engineer grow.',
      "- Situation and the engineer's starting point\n- How you tailored your support (pairing, reviews, stretch tasks)\n- How you gave hard feedback\n- Measurable change in their work",
    ),
    q(
      'behavioural',
      ['r5', 'r6'],
      2,
      'Describe a time you disagreed with a senior colleague about a technical decision. How was it resolved?',
      '- Keep it factual and respectful\n- How you made your case (data, prototypes, writing)\n- What you did once a decision was made\n- What you learned',
    ),
    q(
      'company-fit',
      ['r7'],
      1,
      'Why payments, and why Ledgerly in particular?',
      '- What interests you about moving money correctly\n- Something specific about Ledgerly (4,000 businesses, payouts in 30 countries)\n- How your experience maps to the Payments Core team',
    ),
    q(
      'company-fit',
      [],
      1,
      'Ledgerly writes a design doc for every change. How do you feel about working that way?',
      '- Honest view of writing-first cultures\n- An example of async decision-making that worked\n- How you keep documents short and useful',
    ),
  ];

  // Builder state, so the demo shows what the badges mean.
  questions[1] = { ...questions[1], edited: true };
  questions[4] = { ...questions[4], pinned: true };
  questions.splice(3, 0, {
    ...q(
      'technical',
      ['r1'],
      2,
      "How would you explain Go's context package to a junior engineer?",
      '- Cancellation and deadlines flow down the call tree\n- Always pass ctx as the first argument\n- Never store it in a struct',
    ),
    origin: 'user',
  });

  const flashcards = [
    card(
      ['r3'],
      'What makes an API operation idempotent?',
      'Repeating the same request has the same effect as making it once. For payments: store an idempotency key and return the original result on retry.',
    ),
    card(
      ['r3'],
      'Why not simply retry a failed payment call?',
      'The first call may have succeeded and only the response was lost. Retrying without an idempotency key risks charging twice.',
    ),
    card(
      ['r2'],
      'What does EXPLAIN ANALYZE add over EXPLAIN?',
      "It runs the query and shows real row counts and timings next to the planner's estimates, so you can see where estimates are wrong.",
    ),
    card(
      ['r2'],
      'Why store money as integer minor units?',
      "Floats cannot represent most decimal amounts exactly; rounding errors accumulate. Store cents (or the currency's minor unit) as integers.",
    ),
    card(
      ['r4'],
      'What is the transactional outbox pattern?',
      'Write the event to an outbox table in the same database transaction as the state change; a relay publishes it to Kafka. No lost or phantom events.',
    ),
    card(
      ['r4'],
      'At-least-once vs exactly-once delivery?',
      'At-least-once may deliver duplicates, so consumers must be idempotent. True exactly-once end to end is rare; aim for effectively-once.',
    ),
    card(
      ['r1'],
      'Three ways to stop a slow dependency taking a service down',
      'Timeouts on every call, bounded pools (bulkheads), and a circuit breaker that fails fast.',
    ),
    card(
      ['r5'],
      'Structure of a good design doc',
      'Context, goals and non-goals, proposal, alternatives considered, risks, rollout plan. Short enough to be read.',
    ),
    card(
      ['r6'],
      'STAR, in one line each',
      'Situation: the context. Task: your responsibility. Action: what you did. Result: the measurable outcome.',
    ),
    card(
      ['r7'],
      'What is double-entry bookkeeping?',
      'Every transaction has entries in at least two accounts that sum to zero, so money is never created or lost.',
    ),
  ];

  return assemble({
    jd: PAYMENTS_JD,
    companyUrl: 'https://ledgerly.example',
    days: 6,
    company: 'Ledgerly',
    role: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      location: 'Remote (Europe)',
      responsibilities: [
        'Design and run the services that record every payment in the double-entry ledger',
        'Improve the reliability of payouts across 30 countries',
        'Mentor two mid-level engineers and review designs across teams',
      ],
      requirements,
      thin: false,
      notes: [],
      dropped: [{ text: 'AWS certification', reason: 'Not found in the job description.' }],
    },
    brief: {
      summary:
        'Ledgerly is a payments platform that moves money for about 4,000 online businesses. Engineering is remote-first across Europe and works from written design documents.',
      what_they_do:
        'Payment acceptance, a double-entry ledger and payouts to sellers in 30 countries, sold to online marketplaces and platforms.',
      sources: ['https://ledgerly.example/', 'https://ledgerly.example/about'],
      found: true,
    },
    hiringProcess: {
      found: true,
      stages: [
        {
          name: 'Recruiter call',
          type: 'recruiter-screen',
          description: '30 minutes on your background and what you are looking for.',
          source_url: 'https://ledgerly.example/careers/how-we-hire',
        },
        {
          name: 'Take-home exercise',
          type: 'take-home',
          description: 'Build a small idempotent payments API; about three hours.',
          source_url: 'https://ledgerly.example/careers/how-we-hire',
        },
        {
          name: 'System design',
          type: 'system-design',
          description: 'Design a payout or ledger system with two engineers.',
          source_url: 'https://ledgerly.example/careers/how-we-hire',
        },
        {
          name: 'Values and collaboration',
          type: 'behavioural',
          description: 'Written communication, mentoring and disagreement.',
          source_url: 'https://ledgerly.example/careers/how-we-hire',
        },
      ],
      notes: ['Candidates report the take-home is reviewed by the team you would join.'],
      sources: ['https://ledgerly.example/careers/how-we-hire'],
    },
    research: {
      site_reachable: true,
      site_error: null,
      hiring_page: 'https://ledgerly.example/careers/how-we-hire',
      about_page: 'https://ledgerly.example/about',
      pages_crawled: [
        { url: 'https://ledgerly.example/', kind: 'home' },
        { url: 'https://ledgerly.example/careers/how-we-hire', kind: 'hiring' },
        { url: 'https://ledgerly.example/about', kind: 'about' },
        { url: 'https://ledgerly.example/careers', kind: 'hiring' },
      ],
      skipped_sources: [
        {
          url: 'https://ledgerly.example/careers/benefits.pdf',
          code: 'UNSUPPORTED_CONTENT_TYPE',
          message: 'Skipped application/pdf content.',
        },
      ],
      discussion: {
        query: 'Ledgerly interview',
        source: 'Hacker News (hn.algolia.com)',
        error: null,
        results: [],
      },
    },
    questions,
    flashcards,
    coverageHistory: [
      { pass: 1, uncovered_requirement_ids: ['r6', 'r8'] },
      { pass: 2, uncovered_requirement_ids: [] },
    ],
    stories: [
      {
        title: 'Rewriting the reconciliation job',
        situation: 'Nightly reconciliation missed about 0.3% of payouts and nobody trusted it.',
        action:
          'Wrote a two-page design doc comparing three fixes, ran a review with finance, then shipped an idempotent rewrite behind a flag.',
        result:
          'Mismatches dropped to zero for six months; the doc became the template for the team.',
        requirement_ids: ['r5'],
      },
      {
        title: 'Coaching Priya to lead a migration',
        situation: 'A mid-level engineer wanted to lead but had never run a project.',
        action:
          'Paired on the plan, reviewed her design doc twice, then stepped back and only joined the weekly check-in.',
        result: 'She led the Kafka migration end to end and was promoted the next cycle.',
        requirement_ids: ['r6'],
      },
    ],
    practice: {
      f1: progress(4, 'good', '2026-09-21T09:00:00Z', 3),
      f3: progress(1, 'again', '2026-09-21T09:02:00Z', 2),
      f5: progress(2, 'hard', '2026-09-21T09:04:00Z', 1),
    },
  });
}

// ─── 2. A real company, realistic content ───────────────────────────────────

const POSTHOG_JD = `Product Engineer — PostHog
Location: Remote (US/EU time zones)

What you'll do
- Own features end to end, from talking to users to shipping code
- Work across our React frontend and Python/Django backend
- Help debug customer issues in production

Requirements
- 3+ years of professional software engineering experience
- Strong experience with React and TypeScript
- Experience with Python (Django preferred)
- Comfortable working with SQL and large datasets
- Clear written communication; we are a remote, async company

Nice to have
- Experience with ClickHouse
- You've built or run a startup before`;

function posthogKit() {
  const requirements = [
    req('r1', '3+ years of professional software engineering experience', 'technical', 'must'),
    req('r2', 'Strong experience with React', 'technical', 'must'),
    req('r3', 'Strong experience with TypeScript', 'technical', 'must'),
    req('r4', 'Experience with Python', 'technical', 'must'),
    req('r5', 'Comfortable working with SQL and large datasets', 'technical', 'must'),
    req('r6', 'Clear written communication', 'behavioural', 'must'),
    req('r7', 'Experience with ClickHouse', 'technical', 'nice'),
    req('r8', "You've built or run a startup before", 'domain', 'nice'),
  ];
  const questions = [
    q(
      'technical',
      ['r2'],
      2,
      'A dashboard with 200 charts feels sluggish when one filter changes. How do you find and fix the problem in React?',
      '- Profile with React DevTools; find what re-renders\n- Memoise expensive children, stabilise props and callbacks\n- Split state so one filter does not re-render everything\n- Virtualise off-screen charts\n- Measure again',
    ),
    q(
      'technical',
      ['r3'],
      2,
      'How would you type an API response whose shape depends on a "kind" field?',
      '- Discriminated union keyed on kind\n- Narrow with a switch; exhaustiveness check with never\n- Validate at the boundary (e.g. zod) rather than trusting casts',
    ),
    q(
      'technical',
      ['r4'],
      2,
      'In Django, a list endpoint makes hundreds of database queries. What is happening and how do you fix it?',
      '- The N+1 query problem\n- select_related for foreign keys, prefetch_related for many-to-many\n- Confirm with the debug toolbar or query logging\n- Add a test that asserts the number of queries',
    ),
    q(
      'technical',
      ['r5', 'r7'],
      3,
      'Write a query for daily active users over 90 days on a billion-row events table. What makes it fast?',
      '- Filter on the time column first (partition pruning)\n- count(DISTINCT user) or an approximate uniq in ClickHouse\n- Pre-aggregated materialised views for dashboards\n- Why a columnar store suits this query',
    ),
    q(
      'technical',
      ['r1', 'r3'],
      2,
      'Walk me through a feature you shipped end to end. What would you do differently now?',
      '- The user problem and how you found it\n- Technical decisions and trade-offs\n- How you measured success\n- An honest lesson',
    ),
    q(
      'behavioural',
      ['r6'],
      2,
      'Tell me about a time a written message avoided a meeting, or a meeting was needed because writing failed.',
      '- Context of the async team\n- What you wrote and why\n- The outcome\n- What makes async writing work',
    ),
    q(
      'behavioural',
      ['r8'],
      2,
      'Tell me about a time you built a product feature from scratch with very limited resources. What did you cut?',
      '- The constraint\n- How you chose the smallest useful version\n- What you deliberately left out\n- What users said',
    ),
    q(
      'company-fit',
      [],
      1,
      'PostHog publishes its handbook and pays candidates for a SuperDay. What do you think of that process?',
      '- Show you read the handbook\n- What a paid trial day tells you about the team\n- How you would prepare for it',
    ),
    q(
      'company-fit',
      ['r8'],
      1,
      'PostHog expects product engineers to talk to users. How have you done that before?',
      '- A concrete example\n- What you learned that changed the product\n- How you balance user requests with product vision',
    ),
  ];
  const flashcards = [
    card(
      ['r2'],
      'When does React re-render a component?',
      'When its state changes, its parent re-renders, or a context it uses changes. memo() skips re-renders when props are shallowly equal.',
    ),
    card(
      ['r3'],
      'What is a discriminated union?',
      'A union of object types sharing a literal field (e.g. kind) that TypeScript uses to narrow the type in a switch or if.',
    ),
    card(
      ['r4'],
      'select_related vs prefetch_related',
      'select_related: SQL join, for foreign keys and one-to-one. prefetch_related: a second query joined in Python, for many-to-many and reverse relations.',
    ),
    card(
      ['r5'],
      'Why is a columnar database fast for analytics?',
      'It reads only the columns a query needs, compresses them well and processes values in vectors.',
    ),
    card(
      ['r7'],
      'What is a ClickHouse materialised view?',
      'A table filled automatically on insert by a query, used to keep pre-aggregated results for fast dashboards.',
    ),
    card(
      ['r6'],
      'Three habits of good async writing',
      'Lead with the conclusion, give the context someone needs to act, and say what you need from the reader and by when.',
    ),
  ];
  return assemble({
    jd: POSTHOG_JD,
    companyUrl: 'https://posthog.com',
    days: 5,
    company: 'PostHog',
    role: {
      title: 'Product Engineer',
      seniority: 'Not stated',
      location: 'Remote (US/EU time zones)',
      responsibilities: [
        'Own features end to end, from talking to users to shipping code',
        'Work across our React frontend and Python/Django backend',
        'Help debug customer issues in production',
      ],
      requirements,
      thin: false,
      notes: [],
      dropped: [],
    },
    brief: {
      summary:
        'PostHog builds an all-in-one product platform for engineers: analytics, session replay, feature flags and experiments. It works in public, with a detailed handbook describing culture, pay and hiring.',
      what_they_do:
        'Product analytics and developer tools, open source and cloud-hosted, used by engineering-led teams.',
      sources: ['https://posthog.com/', 'https://posthog.com/handbook'],
      found: true,
    },
    hiringProcess: {
      found: true,
      stages: [
        {
          name: 'Recruiter screen',
          type: 'recruiter-screen',
          description: 'A short call about you and the role.',
          source_url: 'https://posthog.com/handbook/people/hiring-process',
        },
        {
          name: 'Technical interview',
          type: 'technical-screen',
          description: 'A technical conversation with an engineer.',
          source_url: 'https://posthog.com/handbook/people/hiring-process',
        },
        {
          name: 'Small-team interview',
          type: 'behavioural',
          description: 'Meet the team you would join.',
          source_url: 'https://posthog.com/handbook/people/hiring-process',
        },
        {
          name: 'PostHog SuperDay',
          type: 'work-trial',
          description: 'A paid day of real work with the team.',
          source_url: 'https://posthog.com/handbook/people/hiring-process',
        },
      ],
      notes: ['Candidates on Hacker News describe the SuperDay as a paid trial work day.'],
      sources: ['https://posthog.com/handbook/people/hiring-process'],
    },
    research: {
      site_reachable: true,
      site_error: null,
      hiring_page: 'https://posthog.com/handbook/people/hiring-process',
      about_page: 'https://posthog.com/handbook',
      pages_crawled: [
        { url: 'https://posthog.com/', kind: 'home' },
        { url: 'https://posthog.com/handbook', kind: 'about' },
        { url: 'https://posthog.com/handbook/people/hiring-process', kind: 'hiring' },
        { url: 'https://posthog.com/careers', kind: 'hiring' },
      ],
      skipped_sources: [],
      discussion: {
        query: 'PostHog interview',
        source: 'Hacker News (hn.algolia.com)',
        error: null,
        results: [
          {
            url: 'https://news.ycombinator.com/item?id=43274471',
            title: "Things we've learned about building products",
          },
          {
            url: 'https://news.ycombinator.com/item?id=43271413',
            title: "Things we've learned about building products",
          },
        ],
      },
    },
    questions,
    flashcards,
    coverageHistory: [{ pass: 1, uncovered_requirement_ids: [] }],
    practice: {
      f1: progress(3, 'good', '2026-09-22T18:00:00Z', 2),
      f2: progress(2, 'hard', '2026-09-22T18:01:00Z', 2),
      f4: progress(1, 'again', '2026-09-22T18:03:00Z', 1),
    },
  });
}

// ─── 3. A two-line posting: thin, and honest about it ───────────────────────

const STUB_JD = 'Frontend developer needed.\nReact.';

function stubKit() {
  const requirements = [req('r1', 'React', 'technical', 'must')];
  const questions = [
    q(
      'technical',
      ['r1'],
      2,
      'How does React decide what to update in the DOM when state changes?',
      '- Re-render produces a new element tree\n- Reconciliation compares it with the previous one\n- Keys identify list items across renders\n- Only the differences are applied to the DOM',
    ),
    q(
      'technical',
      ['r1'],
      1,
      'When would you reach for useEffect, and when should you avoid it?',
      '- Syncing with something outside React (subscriptions, timers, the DOM)\n- Not for deriving state from props or state\n- Clean-up functions and dependency arrays',
    ),
    q(
      'behavioural',
      [],
      1,
      'Tell me about a front-end feature you are proud of.',
      '- What it did and for whom\n- A hard problem you solved\n- The result',
    ),
    q(
      'company-fit',
      [],
      1,
      'What do you know about GitLab, and why would you like to work there?',
      '- All-remote, handbook-first company\n- A DevSecOps platform used by millions of developers',
    ),
  ];
  const flashcards = [
    card(
      ['r1'],
      'What are React keys for?',
      'They identify list items between renders so React can keep state and DOM nodes with the right item.',
    ),
    card(
      ['r1'],
      'Props vs state',
      'Props are inputs from the parent and read-only; state is owned by the component and changes over time.',
    ),
  ];
  return assemble({
    jd: STUB_JD,
    companyUrl: 'https://about.gitlab.com',
    days: 1,
    company: 'GitLab',
    role: {
      title: 'Frontend developer',
      seniority: 'Not stated',
      location: 'Not stated',
      responsibilities: [],
      requirements,
      thin: true,
      notes: [
        'The job description is short (34 characters) and states 1 requirement. The kit covers only what the posting says.',
        '2 suggested requirement(s) were dropped because the posting does not state them.',
      ],
      dropped: [
        { text: 'HTML and CSS', reason: 'Not found in the job description.' },
        { text: 'Git', reason: 'Not found in the job description.' },
      ],
    },
    brief: {
      summary:
        'GitLab is a publicly traded, all-remote company behind a DevSecOps platform. It is known for its public handbook, which documents how the company works.',
      what_they_do: 'A single application for planning, building, securing and deploying software.',
      sources: ['https://about.gitlab.com/', 'https://about.gitlab.com/company/'],
      found: true,
    },
    hiringProcess: { found: false, stages: [], notes: [], sources: [] },
    research: {
      site_reachable: true,
      site_error: null,
      hiring_page: 'https://about.gitlab.com/jobs/',
      about_page: 'https://about.gitlab.com/company/',
      pages_crawled: [
        { url: 'https://about.gitlab.com/', kind: 'home' },
        { url: 'https://about.gitlab.com/company/', kind: 'about' },
        { url: 'https://about.gitlab.com/jobs/', kind: 'hiring' },
      ],
      skipped_sources: [],
      discussion: {
        query: 'GitLab interview',
        source: 'Hacker News (hn.algolia.com)',
        error: null,
        results: [],
      },
    },
    questions,
    flashcards,
    coverageHistory: [{ pass: 1, uncovered_requirement_ids: [] }],
    practice: {},
  });
}

// ─── Assembly ────────────────────────────────────────────────────────────────

function assemble({
  stories = [],
  jd,
  companyUrl,
  days,
  company,
  role,
  brief,
  hiringProcess,
  research,
  questions,
  flashcards,
  coverageHistory,
  practice,
}) {
  const kitQuestions = questions.map((item, i) => ({ id: `q${i + 1}`, ...item }));
  const kitFlashcards = flashcards.map((item, i) => ({ id: `f${i + 1}`, ...item }));
  const kit = {
    source: {
      company,
      company_url: companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: jd.length,
      researched_at: RESEARCHED_AT,
      pages_used: [...new Set([...brief.sources, ...hiringProcess.sources])],
    },
    company_brief: { ...brief, hiring_process: hiringProcess, research },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
      thin: role.thin,
      notes: role.notes,
      dropped_requirements: role.dropped,
    },
    questions: kitQuestions,
    flashcards: kitFlashcards,
    stories: stories.map((story, i) => ({
      id: `s${i + 1}`,
      question_ids: [],
      origin: 'user',
      edited: false,
      pinned: false,
      ...story,
    })),
    // The demo plan starts today, so "today" always falls on day 1.
    schedule: {
      ...buildSchedule({ requirements: role.requirements, questions: kitQuestions, days }),
      start_date: new Date().toISOString().slice(0, 10),
    },
    coverage: {
      uncovered_requirement_ids: findCoverageGaps(role.requirements, kitQuestions).uncovered,
      passes: coverageHistory.length,
      template_filled_requirement_ids: [],
      history: coverageHistory,
    },
    meta: { warnings: [], steps: [], demo: true },
  };
  const check = validateKit(kit);
  if (!check.ok) throw new Error(`Demo kit for ${company} is invalid: ${check.errors.join('; ')}`);
  return { input: { jd, company_url: companyUrl, days }, kit, practice };
}

function req(id, text, kind, priority) {
  return { id, text, kind, priority, priority_source: 'posting', evidence: text };
}

function q(category, requirement_ids, difficulty, prompt, answer_outline) {
  return {
    requirement_ids,
    category,
    prompt,
    answer_outline,
    difficulty,
    origin: 'generated',
    edited: false,
    pinned: false,
  };
}

function card(requirement_ids, front, back) {
  return { front, back, requirement_ids, origin: 'generated', edited: false, pinned: false };
}

function progress(box, lastRating, at, reviews) {
  return { box, last_rating: lastRating, last_reviewed_at: new Date(at).toISOString(), reviews };
}

export function demoKits() {
  return [paymentsKit(), posthogKit(), stubKit()];
}

/** A failed generation, to show the error state and the Retry button. */
export const FAILED_DEMO_INPUT = {
  jd: 'Data Engineer\n\nRequirements\n- 3+ years with Python and Airflow\n- Experience with dbt and Snowflake\n- Good communication',
  company_url: 'https://example.com',
  days: 7,
};
