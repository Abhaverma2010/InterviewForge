'use client';

// The day-by-day plan. It is computed by code from the questions, so it is
// regenerated rather than hand-edited: after adding or removing questions, or
// when the interview date moves, regenerate it (optionally with new days).
// "Re-plan from today" is the adaptive version: the days actually left, with
// the must-haves practice shows you are weakest on first.

import { useState } from 'react';
import { CATEGORY_LABELS, formatMinutes } from '@/lib/format';
import { Alert, Badge, Button, Card, inputClass, useToast } from '../ui';

export function ScheduleView({ editor }) {
  const { record, draft, regenerate, busy } = editor;
  const { schedule } = record.kit;
  const toast = useToast();
  const [days, setDays] = useState(String(schedule.days_available));
  const byId = Object.fromEntries(draft.questions.map((q) => [q.id, q]));

  const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
  const unscheduled = draft.questions.filter((q) => !scheduled.has(q.id)).length;
  const removed = [...scheduled].filter((id) => !byId[id]).length;
  const total = schedule.days.reduce((t, d) => t + d.minutes, 0);
  const insights = record.insights;
  const today = insights?.current_day;
  const reqById = Object.fromEntries(record.kit.role.requirements.map((r) => [r.id, r]));

  async function onReplan() {
    const result = await regenerate({ section: 'schedule', adaptive: true });
    toast(
      result.ok
        ? { message: `Re-planned over the ${insights.days_left} day(s) left, weakest must-haves first.` }
        : { message: result.error.message, tone: 'error' },
    );
  }

  async function onRegenerate() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      toast({ message: 'Days must be a whole number from 1 to 365.', tone: 'error' });
      return;
    }
    const result = await regenerate({ section: 'schedule', days: n });
    toast(
      result.ok
        ? { message: `Schedule rebuilt over ${n} day${n === 1 ? '' : 's'}.` }
        : { message: result.error.message, tone: 'error' },
    );
  }

  return (
    <div>
      {insights && (
        <ReadinessCard
          insights={insights}
          schedule={schedule}
          reqById={reqById}
          busy={busy.schedule}
          onReplan={onReplan}
        />
      )}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-600">
          {schedule.days_available} day{schedule.days_available === 1 ? '' : 's'} · {formatMinutes(total)} in
          total. Must-have and harder material comes first; with three or more days, the last day is for
          review.
        </p>
        <div className="no-print flex items-end gap-2">
          <div>
            <label htmlFor="schedule-days" className="block text-xs font-medium text-slate-700">
              Days
            </label>
            <input
              id="schedule-days"
              type="number"
              min={1}
              max={365}
              className={`${inputClass} w-20`}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <Button variant="secondary" busy={busy.schedule} onClick={onRegenerate}>
            Regenerate schedule
          </Button>
        </div>
      </div>

      {(unscheduled > 0 || removed > 0) && (
        <Alert tone="info" className="mt-4">
          {unscheduled > 0 && `${unscheduled} question(s) are not in the schedule yet. `}
          {removed > 0 && `${removed} scheduled question(s) were deleted. `}
          Regenerate the schedule to include your changes.
        </Alert>
      )}

      <ol className="mt-5 space-y-3">
        {schedule.days.map((day) => (
          <li key={day.day} aria-current={day.day === today ? 'date' : undefined}>
            <Card
              className={day.day === today ? 'ring-2 ring-brand-500' : day.day < today ? 'opacity-60' : ''}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  Day {day.day} {day.day === today && <Badge tone="brand">Today</Badge>}{' '}
                  <span className="font-normal text-slate-600">· {day.focus}</span>
                </h2>
                <Badge>{formatMinutes(day.minutes)}</Badge>
              </div>
              {day.question_ids.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Read the company brief and review your notes.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {day.question_ids.map((id) => (
                    <li key={id} className="flex gap-2 text-sm">
                      <span className="w-8 shrink-0 font-mono text-xs leading-5 text-slate-400">{id}</span>
                      {byId[id] ? (
                        <span>
                          {byId[id].prompt}{' '}
                          <span className="text-xs text-slate-500">
                            ({CATEGORY_LABELS[byId[id].category]})
                          </span>
                        </span>
                      ) : (
                        <span className="italic text-slate-400">Deleted question</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReadinessCard({ insights, schedule, reqById, busy, onReplan }) {
  const { readiness, current_day: today, days_left: left } = insights;
  const behind = today > 1 && today <= schedule.days_available;
  const tone =
    readiness.score >= 70 ? 'text-emerald-700' : readiness.score >= 40 ? 'text-amber-700' : 'text-red-700';

  return (
    <Card aria-labelledby="readiness-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <p className={`text-4xl font-bold tabular-nums ${tone}`} aria-describedby="readiness-heading">
            {readiness.score}%
          </p>
          <div>
            <h2 id="readiness-heading" className="font-semibold">
              Readiness
            </h2>
            <p className="text-xs text-slate-500">
              From your practice ratings; must-haves count double. Day{' '}
              {Math.min(today, schedule.days_available)} of {schedule.days_available}
              {today > schedule.days_available ? ' (the plan has ended)' : ''}.
            </p>
          </div>
        </div>
        <div className="no-print text-right">
          <Button busy={busy} onClick={onReplan}>
            Re-plan from today
          </Button>
          <p className="mt-1 text-xs text-slate-500">
            {left} day{left === 1 ? '' : 's'} left{behind ? ', earlier days dropped' : ''}; weakest first.
          </p>
        </div>
      </div>
      {readiness.shaky_must.length > 0 && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-medium">Still shaky on must-haves: </span>
          {topThree(readiness.shaky_must, reqById)}.
        </p>
      )}
      {schedule.adaptive && (
        <p className="mt-2 text-xs text-slate-500">
          This plan was re-planned on {new Date(schedule.adaptive.replanned_at).toLocaleDateString()} at{' '}
          {schedule.adaptive.readiness_score}% readiness
          {schedule.adaptive.prioritised.length > 0 &&
            `, putting your weakest must-haves first (${topThree(schedule.adaptive.prioritised, reqById)})`}
          .
        </p>
      )}
    </Card>
  );
}

// "A, B, C and 3 more": long requirement lists stay scannable.
function topThree(ids, reqById) {
  const names = ids.slice(0, 3).map((id) => reqById[id]?.text ?? id);
  const more = ids.length - names.length;
  return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ');
}
