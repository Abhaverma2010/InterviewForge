'use client';

// Shown while a kit is being generated: each phase with its state, the
// individual steps inside it, elapsed time and, when a step failed without
// stopping the run, a note saying the kit will be built from what was found.

import { useEffect, useState } from 'react';
import { PHASES, phaseOf, stepLabel } from '@/lib/format';
import { Alert, Spinner } from './ui';

export function GenerationProgress({ status }) {
  const steps = status.progress?.steps ?? [];
  const startedAt = steps[0]?.at;
  const elapsed = useElapsed(startedAt);

  const phaseState = (key) => {
    const own = steps.filter((s) => phaseOf(s.step) === key);
    if (!own.length) return 'pending';
    const laterStarted = steps.some((s) => {
      const p = PHASES.findIndex((ph) => ph.key === phaseOf(s.step));
      return p > PHASES.findIndex((ph) => ph.key === key) || s.step === 'complete';
    });
    const failed = own.some((s) => s.status === 'failed');
    const open = own.some(
      (s) => s.status === 'started' && !own.some((d) => d.step === s.step && d.status !== 'started'),
    );
    if (open && !laterStarted) return 'running';
    return failed ? 'partial' : 'done';
  };

  // Individual steps within the phases that have several (questions, coverage passes).
  const detail = (key) =>
    [...new Map(steps.filter((s) => phaseOf(s.step) === key).map((s) => [s.step, s])).values()].filter(
      (s) => s.step !== key,
    );

  const warnings = steps.filter((s) => s.status === 'failed');

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center gap-3">
        <Spinner className="h-6 w-6 text-brand-600" />
        <div>
          <h2 className="text-lg font-semibold">
            {status.status === 'queued' ? 'Waiting to start…' : 'Building your kit…'}
          </h2>
          <p className="text-sm text-slate-600">
            {status.status === 'queued' && status.queue_position > 0
              ? `${status.queue_position} kit${status.queue_position === 1 ? '' : 's'} ahead of yours. `
              : ''}
            Usually 1–3 minutes{elapsed ? ` · ${elapsed} so far` : ''}. You can leave this page; we keep
            working.
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-3" aria-live="polite" aria-label="Generation steps">
        {PHASES.map((phase) => {
          const state = status.status === 'queued' ? 'pending' : phaseState(phase.key);
          const subSteps = detail(phase.key);
          return (
            <li key={phase.key} className="flex gap-3">
              <StateIcon state={state} />
              <div className="min-w-0">
                <p className={`text-sm ${state === 'pending' ? 'text-slate-400' : 'text-slate-800'}`}>
                  {phase.label}
                  <span className="sr-only"> ({state})</span>
                </p>
                {subSteps.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {subSteps.map((s) => (
                      <li key={s.step} className="text-xs text-slate-500">
                        {s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : '…'} {stepLabel(s.step)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {warnings.length > 0 && (
        <Alert tone="warning" className="mt-6" title="Some steps did not succeed">
          The kit will be built from what we could find, and it will say what is missing.
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.step}>
                {stepLabel(w.step)}: {w.detail}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

function StateIcon({ state }) {
  const base = 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs';
  if (state === 'done')
    return (
      <span className={`${base} bg-emerald-500 text-white`} aria-hidden="true">
        ✓
      </span>
    );
  if (state === 'partial')
    return (
      <span className={`${base} bg-amber-400 text-white`} aria-hidden="true">
        !
      </span>
    );
  if (state === 'running') return <Spinner className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />;
  return <span className={`${base} border-2 border-slate-200`} aria-hidden="true" />;
}

function useElapsed(since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
