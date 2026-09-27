# InterviewForge

Paste a job description, give the company's website and say how many days you have. InterviewForge
researches the company (it crawls the site to find what they do and how they hire, and looks for public
discussion of their interviews), extracts what the role really requires, and builds a structured prep
kit: a company brief, a role breakdown, a categorised question bank, flashcards and a day-by-day study
schedule. You can reshape every part of it, regenerate one section without losing your edits, and
practise against it.

- **Live app:** https://interview-forge-web.vercel.app · **API:** https://interviewforge-api-dycm.onrender.com (health check: [`/api/health`](https://interviewforge-api-dycm.onrender.com/api/health); the free plan sleeps, so the first request can take ~50 s)
- **Demo account:** `demo@interviewforge.dev` / `demo-password-2026` (ready-made kits, no waiting)
- **Walkthrough video:** _add the link here_

---

## Contents

1. [Tech stack](#tech-stack)
2. [Setup](#setup) (local, batch entry point, deployment)
3. [LLM provider and model](#llm-provider-and-model)
4. [Architecture](#architecture)
5. [Retrieval approach and sources](#retrieval-approach-and-sources)
6. [How research and generation are sequenced](#how-research-and-generation-are-sequenced)
7. [Generated, edited and pinned state](#generated-edited-and-pinned-state)
8. [How the schedule is allocated](#how-the-schedule-is-allocated)
9. [Creative features](#creative-features) (Story bank, Adaptive plan)
10. [Edge cases and failure handling](#edge-cases-and-failure-handling)
11. [Security](#security)
12. [Testing](#testing)
13. [Key decisions and trade-offs](#key-decisions-and-trade-offs)
14. [Known limitations](#known-limitations)

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **Tailwind CSS 4** | The preferred stack. Client components, because every screen is interactive and talks to the API with the user's session. |
| Drag and drop | **dnd-kit** | Accessible: keyboard dragging and screen-reader announcements out of the box. |
| Backend | **Node.js + Express 5** | The preferred stack. |
| Database | **MongoDB** (Atlas free tier) via Mongoose | A kit is one document that is always read, validated and written whole; a document store fits it exactly. |
| Sessions | express-session + connect-mongo, bcrypt | Server-side sessions with an httpOnly cookie; simple and revocable. |
| Validation | **zod** | One schema library for request bodies, LLM output and the Appendix A kit. |
| Scraping | Node `fetch` + **cheerio** | Static HTML parsing is enough for company and hiring pages, and far lighter than a headless browser. |
| LLM | **Google Gemini** (free tier) through its OpenAI-compatible endpoint | See below. |
| Language | **JavaScript** (ES modules), JSDoc on public functions | As allowed by the brief; kept the timebox realistic. |
| Tests | Node's built-in `node:test` | No extra dependencies; runs everywhere Node runs. |

The repository is an npm workspaces monorepo:

```
packages/core   the pipeline and all domain logic: retrieval, extraction, generation,
                coverage, scheduling, validation, builder, practice, story bank. No HTTP, no DB.
apps/api        Express API: auth, kits, background generation queue, persistence
apps/web        Next.js frontend
scripts/        batch entry point (npm run evaluate) and developer tools
```

---

## Setup

Requirements: **Node.js 20.12 or newer** (22 recommended) and npm.

### Local

```bash
git clone https://github.com/Abhaverma2010/InterviewForge.git
cd InterviewForge
npm ci
npm run setup          # creates .env, asks for your Gemini API key and checks it
```

Get a free Gemini key at <https://aistudio.google.com/apikey>. `npm run models` lists the models your
key can use. Everything else in `.env` has working defaults; every variable is documented in
[`.env.example`](.env.example).

Run the app in two terminals:

```bash
npm run dev:api        # API on http://localhost:4000
npm run dev:web        # web app on http://localhost:3000
```

Without `MONGODB_URI` the API uses an in-memory store (data is lost on restart). With a MongoDB Atlas
connection string in `.env`, data persists.

**Demo data.** `npm run seed:demo` creates the demo account (`demo@interviewforge.dev` /
`demo-password-2026`) in MongoDB with four ready-made kits; running it again resets it. Without MongoDB,
start the API with `SEED_DEMO=true` instead.

### Batch entry point

```bash
npm ci
npm run setup          # or create .env with LLM_API_KEY (see .env.example)
npm run evaluate -- --input examples/cases.json --output kits.json
npm run summarize -- kits.json     # optional: a readable overview of the output
```

- Input: an array of `{ id, jd, company_url, days }` (Appendix B). Output: `{ version, generated_at, kits }`
  with one entry per case, in the Appendix B shape.
- It runs **the same `runPipeline` as the web app** (`packages/core/src/pipeline/run-pipeline.js`).
- Two cases run at a time, sharing one rate-limited LLM client. Three cases took about two minutes on the
  Gemini free tier, so five cases fit well within the fifteen-minute budget.
- A case that fails is recorded (`status: "failed"`, with an error code) and the run continues. A case that
  could only be partly researched (no hiring page, unreachable site) is `ok`, with the gaps recorded in
  the kit.
- Company sites served from `localhost` are allowed for this command (the test sites are local).
  Set `ALLOW_PRIVATE_URLS=false` to forbid them.
- Before running, it checks that the configured model names exist for your key, and says which to use if
  not.

### Deployment

| Part | Host | How |
|---|---|---|
| Database | MongoDB Atlas (free M0) | Create a cluster and a database user; allow access from `0.0.0.0/0`. |
| API | Render (free web service) | **New → Blueprint** and pick this repository: [`render.yaml`](render.yaml) configures build, start and health check. In the dashboard set `MONGODB_URI`, `LLM_API_KEY` and `WEB_ORIGIN` (the Vercel URL). `SESSION_SECRET` is generated. |
| Web | Vercel | Import the repository, set **Root Directory** to `apps/web`, and add the environment variable `API_ORIGIN` = the Render URL (for example `https://interviewforge-api.onrender.com`). |

The browser only ever talks to the Vercel app. Next.js forwards `/api/*` to the API
(`apps/web/next.config.mjs`), so the session cookie is first-party and no CORS is needed. The blueprint
sets `SEED_DEMO=true`, so the API creates the demo account in the database on its first start and leaves
it alone afterwards (`SEED_DEMO=reset` recreates it on every start; `npm run seed:demo` does it from a
local machine).

On the free Render plan the API sleeps after 15 minutes idle; the first request then takes about a
minute. Unfinished generations are resumed when it wakes (see [failure handling](#edge-cases-and-failure-handling)).

---

## LLM provider and model

- **Provider:** Google Gemini, free tier, through its **OpenAI-compatible** chat-completions endpoint.
- **Model:** `gemini-3.6-flash`, with **`gemini-3.5-flash-lite` as an automatic fallback**.

Why Gemini: the free tier's limit on *tokens per minute* is what matters when crawled pages are sent to
the model, and Gemini's is far higher than the alternatives' (Groq's free tier allows about 8K tokens per
minute; one company page can use that). Why the OpenAI-compatible endpoint: switching provider or model is
a change of three environment variables, not code. Any compatible provider (Groq, OpenRouter, a local
model) works the same way, including as the fallback.

The LLM client (`packages/core/src/llm/client.js`) is built for free tiers:

- a **requests-per-minute limiter**, so we slow down before the provider has to tell us to;
- **retries with exponential backoff** on 429/5xx/timeouts, honouring `Retry-After` and Gemini's
  `retryDelay`;
- **failover** to the fallback model when the primary stays overloaded (after 2 retries) or its **daily
  quota** is used up (immediately, since waiting cannot help); a failed model then cools down so later
  calls go straight to the fallback;
- **JSON parsing and schema validation** with one repair round trip that shows the model its invalid output
  and the validation error;
- stable error codes (`LLM_RATE_LIMITED`, `LLM_QUOTA_EXHAUSTED`, `LLM_INVALID_JSON`…).

---

## Architecture

```
Browser ──► Next.js (Vercel) ──/api/*──► Express API (Render) ──► MongoDB Atlas
                                           │
                                           ├─ routes/auth.js       register · login · logout · me
                                           ├─ routes/kits.js       CRUD · batch · status · edit · regenerate · practice
                                           ├─ services/generation-queue.js   background jobs, progress, resume
                                           └─ store/{mongo,memory}.js         one interface, two backends
                                                       │
npm run evaluate ─────────────────────────────► packages/core  (the same code)
                                                 retrieval/   fetcher · robots · url-safety · crawler · link scoring · discussion
                                                 extraction/  requirements + evidence checks
                                                 generation/  company brief · hiring process · questions · flashcards
                                                 coverage/    gap detection
                                                 scheduling/  allocation · adaptive re-plan
                                                 validation/  Appendix A schema + cross-checks
                                                 pipeline/    runPipeline: the ordered steps
                                                 builder/     edits and regeneration that preserve user work
                                                 practice/    Leitner boxes
                                                 stories/     story bank analysis
```

Concerns are separated by folder: **retrieval** never calls the model, **generation** never fetches pages,
**scheduling and coverage** are pure functions, **persistence** is behind a small store interface in the
API, and **the core knows nothing about HTTP or the database**. That is why the batch command and the web
app share one implementation.

**Long-running generation.** `POST /api/kits` stores a `queued` record and returns `202` at once. An
in-process queue runs the pipeline (two at a time), writing each step's progress to the record; the
interface polls `GET /api/kits/:id/status` every two seconds and shows the phases, the per-category steps
and the gap-filling passes. The final write stores the kit (`ready`) or a structured error (`failed`,
retryable).

---

## Retrieval approach and sources

**Sources used**

1. **The company's own website**, crawled from the URL the user gives.
2. **Hacker News**, through the public Algolia search API (`hn.algolia.com`), for candidates' accounts of
   the interview process.

**Not used, on purpose:** Glassdoor, Reddit, LinkedIn and search-engine result pages. Their terms forbid
automated access without an agreement, and the brief asks to respect site terms. The job description is
pasted, never fetched from a job board.

**Finding the hiring page without hard-coded paths.** The crawler (`retrieval/crawler.js`) runs a
best-first search:

1. Fetch the homepage and extract every link, resolving relative links (and `<base href>`) against the
   page, so sites served under a path such as `http://localhost:8099/acme/` work.
2. **Score each link** on the words in its path and anchor text (`link-scoring.js`): "how we hire" and
   "interview process" score highest, then "interview", "careers"/"jobs", "hiring"; "about", "mission",
   "culture" mark about pages; login, privacy, pricing, trials and sign-ups are pushed below zero; blog
   posts and deep paths are penalised; query strings (mostly tracking) are ignored.
3. Always fetch the highest-scoring unvisited link next, adding the links found on each page, up to
   8 pages and 2 clicks from the homepage, staying on the same site (sibling subdomains such as
   `handbook.gitlab.com` count).
4. **Classify pages by their content, not only their link**: a page whose text contains two or more
   hiring-process signals (take-home, system design interview, recruiter screen…) is a hiring page even
   if the link said "Company". The best hiring page is the one with the most signals.

Tuned against real sites: on posthog.com it finds `/handbook/people/hiring-process` two clicks deep; on
about.gitlab.com it finds `/jobs/ai-interview-process/`. Four problems found in those runs (the wrong
"best" page, handbook pages counted as hiring, a careers page over 2 MB, trial pages reached through tracking
parameters) each became a regression test.

**Being a good citizen:** robots.txt is fetched and obeyed (RFC 9309 groups and longest-match rules,
Crawl-delay honoured), requests to one host are spaced 500 ms apart, failures back off, and a source that
cannot be retrieved is recorded with a reason (`NOT_FOUND`, `ROBOTS_DISALLOWED`, `TIMEOUT`…) rather than
failing the run.

---

## How research and generation are sequenced

The kit is built by `runPipeline` in ten deliberate steps. Each responds to what earlier steps found.

| # | Step | Who decides | Responsibility |
|---|---|---|---|
| 1 | **Extract** | model, then code | The model proposes the title, seniority, location, responsibilities and requirements, each with an **exact quote** as evidence. **Code** then drops any requirement whose quote is not in the posting (invented), decides **must/nice from the posting's own wording** ("Required:", "Bonus", "is a plus", a "Nice to have" heading, a bracketed "(Django preferred)" applying only to Django), falling back to the model only where the posting is silent, numbers requirements `r1…` in posting order and flags a **thin** posting. |
| 2 | **Crawl** | code | Company site → pages, best hiring page and about page, skipped sources. |
| 3 | **Discussion** | code | Hacker News search; hits must name the company *and* describe a hiring experience ("user interviews" do not count). |
| 4 | **Company brief** | model | From the home and about pages only. **Skipped when nothing was found**: an unreachable or empty site gives an honest "we could not find information about X" brief with no model call. |
| 5 | **Hiring process** | model | Interview stages from the hiring pages (authoritative) and discussion (reported as "candidates report…"). Skipped when neither exists. |
| 6 | **Questions** | code plans, model writes | **Code** chooses the categories: technical (for technical and domain requirements), **system design only for senior roles, a published design round, or scale work**, behavioural (for behavioural requirements), company fit. **Each category is a separate model call** with its own instructions and only its own requirements. Code then keeps only requirement ids it offered, clamps difficulty to 1–3, removes duplicates and files story-style questions ("Tell me about a time…") as behavioural. |
| 7 | **Coverage (second pass)** | code | See below. |
| 8 | **Flashcards** | model, code fallback | If the call fails, cards are derived from the questions. |
| 9 | **Schedule** | code | Arithmetic; see [schedule](#how-the-schedule-is-allocated). |
| 10 | **Validate** | code | The kit is checked against Appendix A (zod) plus cross-checks (unique ids, references resolve, integer minutes, schedule length) before it is saved. |

The sequencing is genuine: a company whose hiring page describes a take-home and a system design round gets
system-design questions and questions in the take-home's style; a company with no hiring page gets neither
and says so.

**The coverage loop.** Pass 1 checks the first draft: code lists every requirement no question cites. If
there are gaps, the next pass asks the model for **exactly one question per uncovered requirement**, with
only those requirements, and code checks again. **At most three passes.** Why three: in testing the second
pass closes nearly every gap; a third catches the occasional stubborn one, and more rarely helps while
costing free-tier quota. If a must-have is *still* uncovered after that, **code writes a template question**
for it ("Walk me through your experience with…"), so a kit never ships with an uncovered must-have. The
kit's `coverage` records `passes`, the history of each pass and any template-filled requirements; the
interface shows it ("Pass 1: uncovered r2, r3 → asked for targeted questions · Pass 2: all covered").

Only step 1 is fatal (without requirements there is nothing to build on). Every other failure becomes a
warning in `kit.meta.warnings` and the kit is built from what is left.

---

## Generated, edited and pinned state

Every question and flashcard carries three fields (an extension the brief permits):

| Field | Values | Meaning |
|---|---|---|
| `origin` | `generated`, `template`, `user` | Who wrote it: the model, the coverage fallback, or the user. |
| `edited` | boolean | The user has changed its content (text, outline, difficulty, requirements, or category). |
| `pinned` | boolean | The user asked to keep it as it is. |

The company brief carries `edited` and `pinned` too.

**The rule:** a regeneration replaces only items that are **generated (or template), unedited and
unpinned**. Everything the user wrote, touched or pinned survives, stays in its place at the top of the
category, and the new questions follow it. Regenerating the brief is refused while it is pinned.

**`edited` is decided by the server**, by comparing each saved item with the stored one
(`builder/builder.js`). The client never sends it, so a stale or buggy client cannot clear it. `pinned` is
a user choice and is taken as sent.

**Edits in flight and concurrent changes.** The editor applies every change to a local draft immediately
(no round trip per keystroke) and saves in the background, debounced and one save at a time. Each save
carries the kit's `version`, and the server applies it only if the version still matches (an atomic
compare-and-set in MongoDB). On a conflict, the client **rebases** its unsaved changes onto the server's
newer kit (`apps/web/lib/kit-sync.js`): the user's edits, additions, deletions and reordering are replayed
on top of it, and everything they did not touch comes from the server.

**Regeneration never clobbers work in progress.** Pending edits are saved first. The model then works on
the kit as it was; its result is merged into the **latest** saved kit on the server (a pure merge
function, retried under compare-and-set), so edits made while the model was working survive. The browser
test in development checks exactly this: edit a question, regenerate its category, and the edit is still
there.

---

## How the schedule is allocated

Allocation is arithmetic in `scheduling/schedule.js`. No model is involved.

1. **Cost:** every question gets integer minutes: 10 + 10 × difficulty (20, 30 or 40).
2. **Order:** questions covering a must-have requirement come before the rest; within each group, harder
   questions first. Harder, higher-priority material therefore lands early, not the night before.
3. **Split:** the ordered list is cut into consecutive groups whose sizes differ by at most one, bigger
   groups first (7 questions over 3 days → 3, 2, 2).
4. **Review:** with three or more days the last day is kept for review of must-have questions. Days with
   no new material (more days than questions) also become review days, cycling through the must-haves so
   consecutive review days differ.

The result always has **exactly the requested number of days** (1 or 60 alike), every question appears, so
every covered must-have appears, and every day has a focus, question ids and integer minutes. Each day's
focus names the categories covered that day. The schedule records its `start_date`, so the interface can
show which day is today.

---

## Creative features

### 1. Story bank

**The problem.** Interviews ask a dozen "tell me about a time…" questions, but most candidates have four or
five good stories. The night before, what they need to know is *which story answers which question*,
which questions they have no story for, and which story they are leaning on too much.

**What it does.** A **Story bank** tab where you write each story once (title, situation, action,
result) and tag what it shows (mentoring, communication…). The app then shows, for every story question
(behavioural, company fit, or phrased as a story):

- the stories that fit it, either **linked** directly by you or matched by a **shared skill**;
- **"No story yet"** for questions you are not ready for, with a one-click "Link a story…";
- a warning for a story that answers **four or more** questions ("interviewers notice repeats");
- the behavioural requirements **no story shows yet**.

The matching is deterministic (`packages/core/src/stories/story-bank.js`) and runs on the server; stories
are saved, rebased and validated like the rest of the kit.

### 2. Adaptive plan: "Re-plan from today"

**The problem.** A study plan goes stale. You skip a day, or practice reveals that a must-have you thought
you knew is shaky, but the schedule still says what it said on day one.

**What it does.** The Schedule tab shows a **readiness score** and today's day of the plan. **Re-plan
from today** rebuilds the schedule over the days actually left, starting today, putting the must-haves
practice shows you are **weakest** on first.

- A requirement's confidence is the average Leitner box of its flashcards, scaled to 0–1 (an unseen card
  counts as 0: you have not shown you know it). Readiness weights must-haves twice as heavily.
- The allocator orders must-haves by weakness before difficulty (`scheduling/adaptive.js`), and the
  schedule records when and why it was re-planned.

Both features are plain code, no model, which keeps them free, instant and explainable.

**Practice mode** itself uses **Leitner boxes** (1–5): "again" sends a card back to box 1, "hard" down one,
"good" up one, "easy" up two. The next session starts with cards you failed, then unseen ones, then the
lowest boxes, oldest first. I chose Leitner over a full spaced-repetition algorithm such as SM-2 because
interview prep runs over days, not months: long review intervals never come into play, and "show me my
weakest cards first" is exactly what boxes express, in a way a user can understand at a glance.

---

## Edge cases and failure handling

| Case | What happens |
|---|---|
| Company URL invalid | The form rejects obviously invalid input (a bare domain gets `https://`). In the pipeline and the batch command it is recorded (`INVALID_URL`) and the kit is built from the job description with an honest brief. |
| URL returns 404 or times out | Recorded (`NOT_FOUND`, `TIMEOUT`, `NETWORK`, `DNS_FAILED`); same honest brief; the case is still `ok`. |
| No discoverable hiring or about page | The kit says "none found" and questions are based on the role alone; no stages are invented. |
| Two-line job description | Only what it states is extracted; model suggestions not in the text are dropped and listed; the kit is marked **thin** with an explanatory note. |
| Public discussion finds nothing | A normal, empty result ("Nothing found"). |
| Invalid JSON or an incomplete answer from the model | One repair round trip with the validation error; then the step fails with `LLM_INVALID_JSON` and the pipeline continues without it (except extraction). |
| Rate limits or brief failures | Rate limiting, backoff, failover to the fallback model, visible "waiting" messages; a daily-quota error switches model immediately. |
| The same description and company twice | Detected by a hash of the normalised posting and URL (whitespace, case, `www.` and trailing slash ignored): the existing kit is returned, with "Open it" or "Generate a new one anyway". |
| 1-day or 60-day schedule | Always exactly that many days; see the schedule section. |
| Generation takes 90 seconds | Runs in the background with live progress; the user can leave the page. |
| Generation fails halfway | The record stores the error code and message; the kit page offers **Try again**. |
| Server restarts mid-generation | Unfinished records are re-queued on startup. |
| Session expires | API calls answer `401 UNAUTHENTICATED`; the app sends the user to log in and back to the page. |

---

## Security

- **Untrusted pages and postings are data, never instructions.** Every block of fetched or pasted text is
  wrapped in a tag, any copy of that tag inside the text is neutralised, and every prompt tells the model
  to ignore instructions inside those blocks. Model output is then filtered by code (only requirement ids
  we offered, only URLs we fetched), so even a successful injection can only produce text, never an
  action. A test checks that a smuggled closing tag cannot escape.
- **SSRF protection.** Every URL (including every redirect hop, followed manually) must be http(s), carry
  no credentials and resolve to a public address; loopback, private, link-local (cloud metadata), CGNAT and
  multicast ranges are refused in production (`ALLOW_PRIVATE_URLS=false`).
- **Expected content only:** HTML (or JSON for the search API), 10-second timeouts, pages truncated at 5 MB,
  absurd declared sizes refused.
- **Auth:** bcrypt hashes, httpOnly `SameSite=Lax` cookies (secure in production), session id regenerated
  on login, rate-limited login and kit creation, the same response for a wrong email or password. Every
  kit lookup is scoped to the signed-in user, and someone else's kit answers 404, exactly like one that
  does not exist.
- **Validation** of every request body (zod) and of every kit before it is saved; structured errors
  `{ error: { code, message, details } }` everywhere.
- Secrets live only in environment variables; `.env` is git-ignored, and production refuses to start
  without a strong `SESSION_SECRET` and a database.

---

## Testing

```bash
npm test
```

About 240 automated tests, all offline (a scripted fake model and small local HTTP sites stand in for
the real ones), run in CI on every push (`.github/workflows/ci.yml`):

- **Schedule allocation:** costs, ordering, splitting, 1/2/3/5/60 days, review days, every question and
  must-have scheduled, invalid days, adaptive ordering by weakness.
- **Coverage checking:** gap detection, the second pass closing gaps, the template fallback when the model
  never fills them.
- **Structure validation:** the Appendix A example, extensions allowed, and each way a kit can be broken
  (missing field, float minutes, bad ids, dangling references, wrong schedule length…).
- Requirement extraction (invented requirements dropped, must/nice from the posting, thin postings),
  crawling against local fake sites (hiring page at an unguessable path, robots.txt, 404s, non-HTML,
  timeouts, redirects to private addresses), the LLM client (retries, backoff, failover, repair), the API
  (auth, ownership, duplicates, conflicts, regeneration preserving edits, practice), the frontend sync
  logic (rebasing edits), and an **end-to-end run of `npm run evaluate`** as a separate process.

During development the web app was also exercised in a real browser (Playwright): register, create a kit,
watch progress, edit, reorder by keyboard, regenerate a category and check the edit survives, delete and
undo, practise, and check there is no horizontal scrolling at phone width.

---

## Key decisions and trade-offs

- **What the model is not allowed to decide.** Whether a requirement exists (evidence check), must/nice
  when the posting says, which categories run, which ids a question may cite, what counts as a coverage
  gap, when to stop, the schedule, the readiness score and story matching are all decided by code. The
  model writes language: summaries, questions, answer outlines and cards.
- **One pipeline for the app and the batch command**, in a package with no HTTP or database, so both are
  graded on the same code.
- **In-process job queue instead of a separate worker and broker.** Right for one small instance and a free
  tier; restarts are handled by resuming unfinished records. A second instance would need a shared queue.
- **Polling instead of WebSockets or server-sent events** for progress: simpler, works through any proxy,
  and a two-second delay is invisible next to a one-minute generation.
- **The kit as one MongoDB document** with optimistic concurrency on a `version`: the kit is always
  validated and written whole, and compare-and-set makes conflicting saves impossible to miss.
- **Static HTML crawling rather than a headless browser:** far faster and lighter, at the cost of sites
  that render their content only with JavaScript (see limitations).
- **Honesty over fullness:** a thin posting gives a thin kit, an unknown company gives a brief that says it
  is unknown, and system-design questions appear only when the role or the company calls for them.
- **The schedule is regenerated, not hand-edited:** it is derived from the questions; hand-editing it
  would let it drift from them. Re-planning covers the real need (the plan went stale).

## Known limitations

- **JavaScript-only sites:** pages that render their text in the browser yield little content; the kit then
  reports that little was found.
- **Discussion coverage:** only Hacker News is searched; smaller companies often have no discussion there.
- **Same-site detection** uses a small list of two-part suffixes (co.uk, com.au…) instead of the full
  public suffix list.
- **DNS rebinding:** addresses are checked before connecting, but a hostile DNS server could answer
  differently at connect time. Pinning the resolved address per request would close this.
- **Rate limiting by IP** sees the Vercel proxy's address in production, so limits are shared between users
  of the deployed app; fine at this scale, and configurable proxy trust would fix it.
- **Free tiers:** Gemini's daily quotas can run out during heavy use (the fallback model helps), and the
  Render API sleeps when idle, so the first request after a pause is slow.
- **Readiness** is only as good as flashcard coverage: a requirement with no flashcard cannot be measured
  and counts as not yet shown.
- Out of scope, as the brief says: email verification, password reset, sharing and team features.
