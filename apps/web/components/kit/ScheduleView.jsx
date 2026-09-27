'use client';

// The day-by-day plan. It is computed by code from the questions, so it is
// regenerated rather than hand-edited: after adding or removing questions, or
// when the interview date moves, regenerate it (optionally with new days).

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
      <div className="flex flex-wrap items-end justify-between gap-3">
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
          <li key={day.day}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">
                  Day {day.day} <span className="font-normal text-slate-600">· {day.focus}</span>
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
