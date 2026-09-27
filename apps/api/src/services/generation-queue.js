// Runs kit generation in the background.
//
// Generation takes a minute or more, so the API never makes a request wait for
// it: creating a kit stores a 'queued' record and returns at once. This queue
// then runs the pipeline, writing each step's progress to the record so the
// interface can poll it, and finally stores the kit ('ready') or the error
// ('failed'). If the server restarts mid-generation, unfinished records are
// picked up again on startup rather than left spinning forever.

import { runPipeline as defaultRunPipeline } from '@interviewforge/core';

export function createGenerationQueue({
  store,
  llm,
  crawler,
  concurrency = 2,
  timeoutMs = 8 * 60_000,
  runPipeline = defaultRunPipeline,
  logger = console,
}) {
  const waiting = [];
  const active = new Set();
  let idleWaiters = [];

  function enqueue(id) {
    if (!waiting.includes(id) && !active.has(id)) waiting.push(id);
    pump();
  }

  function pump() {
    while (active.size < concurrency && waiting.length) {
      const id = waiting.shift();
      active.add(id);
      run(id)
        .catch((err) => logger.error(`generation ${id} crashed`, err))
        .finally(() => {
          active.delete(id);
          pump();
          if (!active.size && !waiting.length) {
            idleWaiters.forEach((resolve) => resolve());
            idleWaiters = [];
          }
        });
    }
  }

  async function run(id) {
    const record = await store.kits.get(id);
    if (!record || record.status !== 'queued') return;

    const steps = [];
    const progress = () => ({ current: steps.at(-1)?.step ?? null, steps });
    await store.kits.update(id, { status: 'generating', error: null, progress: progress() });

    try {
      const kit = await withTimeout(
        runPipeline(
          { jd: record.input.jd, companyUrl: record.input.company_url, days: record.input.days },
          { llm, crawler },
          {
            onProgress: (event) => {
              steps.push({ ...event, at: new Date().toISOString() });
              // Fire and forget: progress is informational, the final write is what counts.
              store.kits.update(id, { progress: progress() }).catch(() => {});
            },
          },
        ),
        timeoutMs,
      );
      await store.kits.update(id, {
        status: 'ready',
        kit,
        version: 1,
        error: null,
        progress: progress(),
        practice: { cards: {} },
      });
    } catch (err) {
      await store.kits.update(id, {
        status: 'failed',
        error: { code: err.code ?? 'GENERATION_FAILED', message: err.message },
        progress: progress(),
      });
    }
  }

  /** Re-queues records left queued or generating by a previous process. */
  async function resumeUnfinished() {
    const unfinished = await store.kits.findUnfinished();
    for (const record of unfinished) {
      await store.kits.update(record.id, { status: 'queued' });
      enqueue(record.id);
    }
    return unfinished.length;
  }

  /** Resolves when nothing is running or waiting (used by tests and shutdown). */
  function idle() {
    if (!active.size && !waiting.length) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  return { enqueue, resumeUnfinished, idle, position: (id) => waiting.indexOf(id) };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`Generation took longer than ${ms / 1000}s.`), {
            code: 'TIMEOUT',
          }),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
