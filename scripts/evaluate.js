// Batch entry point (brief, section 9):
//   npm run evaluate -- --input <cases.json> --output <kits.json>
//
// Runs the same pipeline as the web app on every case and writes one entry per
// case in the Appendix B format. A case that fails is recorded and the run
// continues. Cases run two at a time; the shared LLM client's rate limiter
// keeps the combined request rate within the provider's free tier.

import './load-env.js';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  createCrawlerDeps,
  createLLMClientFromEnv,
  PipelineError,
  runPipeline,
} from '@interviewforge/core';

const CONCURRENCY = 2;
const CASE_TIMEOUT_MS = 6 * 60_000;

const { values: args } = parseArgs({
  options: { input: { type: 'string' }, output: { type: 'string' } },
});
if (!args.input || !args.output) {
  console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
  process.exit(1);
}

const cases = JSON.parse(await readFile(args.input, 'utf8'));
if (!Array.isArray(cases)) {
  console.error(`${args.input} must contain a JSON array of cases.`);
  process.exit(1);
}

// Test sites for this command may be served from localhost, so private
// addresses are allowed unless explicitly turned off.
const crawler = createCrawlerDeps({ allowPrivate: process.env.ALLOW_PRIVATE_URLS !== 'false' });
let llm;
try {
  llm = createLLMClientFromEnv(process.env, {
    // Make waiting visible: free tiers throttle hard, and a silent retry looks like a hang.
    onEvent: (e) => {
      const seconds = Math.round(e.delayMs / 1000);
      if (e.type === 'retry') {
        console.log(`  [llm] ${e.model}: ${e.reason}, retry ${e.attempt} in ${seconds}s`);
      } else if (e.type === 'failover') {
        console.log(`  [llm] ${e.from} unavailable (${e.reason}), switching to ${e.to}`);
      } else if (e.type === 'throttle' && seconds >= 2) {
        console.log(`  [llm] pacing requests to stay under the rate limit, waiting ${seconds}s`);
      }
    },
  });
} catch (err) {
  console.error(`${err.message} See .env.example.`);
  process.exit(1);
}

console.log(`Models: ${llm.models.join(' → fallback ')}. Running ${cases.length} case(s).`);
// Catch a mistyped model name now, not as a failure in every case.
const missing = (await llm.checkModels()).filter((m) => m.status === 'missing');
for (const m of missing) {
  console.error(`\nModel "${m.model}" is not available to this API key.`);
  if (m.suggestions.length) console.error(`Available models include: ${m.suggestions.join(', ')}`);
}
if (missing.length) {
  console.error('\nFix LLM_MODEL / LLM_FALLBACK_MODEL in .env (npm run models lists them all).');
  process.exit(1);
}
console.log('');
const started = Date.now();
const results = new Array(cases.length);
let next = 0;

async function worker() {
  while (next < cases.length) {
    const index = next++;
    results[index] = await runCase(cases[index], index);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));

const output = {
  version: '1.0',
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  kits: results,
};
await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`);

const ok = results.filter((r) => r.status === 'ok').length;
console.log(
  `\nWrote ${results.length} kits to ${args.output}: ${ok} ok, ${results.length - ok} failed ` +
    `(${Math.round((Date.now() - started) / 1000)}s).`,
);

async function runCase(testCase, index) {
  const id = typeof testCase?.id === 'string' ? testCase.id : `case-${index + 1}`;
  const log = (message) => console.log(`[${id}] ${message}`);
  log('started');

  try {
    const kit = await withTimeout(
      runPipeline(
        { jd: testCase?.jd, companyUrl: testCase?.company_url, days: testCase?.days },
        { llm, crawler },
        {
          onProgress: (e) => {
            if (e.status !== 'started')
              log(`${e.step} ${e.status}${e.detail ? `: ${e.detail}` : ''}`);
          },
        },
      ),
      CASE_TIMEOUT_MS,
    );
    log('ok');
    return { id, status: 'ok', kit, error: null };
  } catch (err) {
    const code = err instanceof PipelineError || err.code ? err.code : 'INTERNAL_ERROR';
    log(`failed: ${code} ${err.message}`);
    return { id, status: 'failed', kit: null, error: { code, message: err.message } };
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`Case took longer than ${ms / 1000}s.`), { code: 'TIMEOUT' }),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
