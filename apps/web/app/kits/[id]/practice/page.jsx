'use client';

// Practice mode. The server orders the session (Leitner boxes: cards you
// failed first, then unseen ones, then your least confident). Keyboard:
// Space or Enter reveals the answer, 1-4 rate it.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, PageLoading } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

const RATINGS = [
  {
    key: 'again',
    label: 'Again',
    hint: "Didn't know it",
    style: 'border-red-200 text-red-800 hover:bg-red-50',
  },
  { key: 'hard', label: 'Hard', hint: 'Shaky', style: 'border-amber-200 text-amber-900 hover:bg-amber-50' },
  {
    key: 'good',
    label: 'Good',
    hint: 'Knew it',
    style: 'border-emerald-200 text-emerald-800 hover:bg-emerald-50',
  },
  { key: 'easy', label: 'Easy', hint: 'Instant', style: 'border-brand-200 text-brand-700 hover:bg-brand-50' },
];

export default function PracticePage() {
  const user = useRequireAuth();
  const { id } = useParams();
  const [kit, setKit] = useState(null);
  const [state, setState] = useState(null); // { order, cards, summary }
  const [queue, setQueue] = useState([]);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState(null);
  const [rating, setRating] = useState(null);
  const [sessionSize, setSessionSize] = useState(0);

  const start = useCallback(async () => {
    try {
      const [{ kit: record }, practice] = await Promise.all([
        api(`/kits/${id}`),
        api(`/kits/${id}/practice`),
      ]);
      setKit(record.kit);
      setState(practice);
      setQueue(practice.order);
      setSessionSize(practice.order.length);
      setPosition(0);
      setRevealed(false);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    if (user) start();
  }, [user, start]);

  const cardId = queue[position];
  const card = kit?.flashcards.find((f) => f.id === cardId);
  const done = state && position >= queue.length;

  const rate = useCallback(
    async (value) => {
      if (!card || rating) return;
      setRating(value);
      try {
        const res = await api(`/kits/${id}/practice`, {
          method: 'POST',
          body: { card_id: card.id, rating: value },
        });
        setState(res);
        setPosition((p) => p + 1);
        setRevealed(false);
      } catch (err) {
        setError(err);
      } finally {
        setRating(null);
      }
    },
    [card, id, rating],
  );

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest('input, textarea, select')) return;
      if (!revealed && (event.key === ' ' || event.key === 'Enter') && card) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        rate(RATINGS[Number(event.key) - 1].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, card, rate]);

  if (error?.code === 'KIT_NOT_READY') {
    return (
      <EmptyState
        title="This kit is still being built"
        action={<ButtonLink href={`/kits/${id}`}>See progress</ButtonLink>}
      />
    );
  }
  if (error && !state) {
    return (
      <Alert
        tone="error"
        title="Could not start practice"
        action={
          <Button size="sm" variant="secondary" onClick={start}>
            Try again
          </Button>
        }
      >
        {error.message}
      </Alert>
    );
  }
  if (!user || !state || !kit) return <PageLoading label="Preparing your session…" />;

  if (!kit.flashcards.length) {
    return (
      <EmptyState
        title="No flashcards to practise"
        action={<ButtonLink href={`/kits/${id}`}>Back to the kit</ButtonLink>}
      >
        Add flashcards in the kit&apos;s Flashcards tab first.
      </EmptyState>
    );
  }

  const requirementText = (rid) => kit.role.requirements.find((r) => r.id === rid)?.text;

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href={`/kits/${id}`} className="text-sm text-brand-700 hover:underline">
              ← {kit.role.title}
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Practice</h1>
          </div>
          <p className="text-sm text-slate-600" aria-live="polite">
            {done ? 'Session complete' : `Card ${position + 1} of ${sessionSize}`}
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div
            className="h-full bg-brand-500 transition-all"
            style={{ width: `${(Math.min(position, sessionSize) / sessionSize) * 100}%` }}
          />
        </div>

        {error && (
          <Alert tone="error" className="mt-4">
            {error.message}
          </Alert>
        )}

        {done ? (
          <Card className="mt-6 text-center">
            <p className="text-lg font-semibold">Session complete</p>
            <p className="mt-1 text-sm text-slate-600">
              Your next session starts with the cards you found hardest.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={start}>Start another session</Button>
              <ButtonLink href={`/kits/${id}`} variant="secondary">
                Back to the kit
              </ButtonLink>
            </div>
          </Card>
        ) : (
          card && (
            <Card className="mt-6">
              <div className="flex flex-wrap gap-1">
                {card.requirement_ids.map((rid) => (
                  <Badge key={rid} tone="brand">
                    {rid}: {requirementText(rid)}
                  </Badge>
                ))}
                {state.cards[card.id] ? (
                  <Badge>Box {state.cards[card.id].box} of 5</Badge>
                ) : (
                  <Badge tone="amber">New</Badge>
                )}
              </div>
              <p className="mt-4 text-lg font-medium leading-relaxed">{card.front}</p>

              {revealed ? (
                <>
                  <div className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-4 text-slate-800">
                    {card.back}
                  </div>
                  <p className="mt-5 text-sm font-medium text-slate-700" id="rate-label">
                    How well did you know it?
                  </p>
                  <div
                    className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
                    role="group"
                    aria-labelledby="rate-label"
                  >
                    {RATINGS.map((r, i) => (
                      <button
                        key={r.key}
                        type="button"
                        disabled={Boolean(rating)}
                        onClick={() => rate(r.key)}
                        className={`rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50 ${r.style}`}
                      >
                        {r.label}
                        <span className="block text-xs font-normal opacity-75">
                          {r.hint} · key {i + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-6">
                  <Button onClick={() => setRevealed(true)} autoFocus>
                    Show answer
                  </Button>
                  <span className="ml-3 text-xs text-slate-500">or press Space</span>
                </div>
              )}
            </Card>
          )
        )}
      </div>

      <aside aria-labelledby="progress-heading">
        <ProgressPanel summary={state.summary} />
      </aside>
    </div>
  );
}

function ProgressPanel({ summary }) {
  const weakest = summary.by_requirement.filter((r) => summary.weakest.includes(r.requirement_id));
  return (
    <Card>
      <h2 id="progress-heading" className="font-semibold">
        Your progress
      </h2>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ['Reviewed', summary.reviewed],
          ['Not yet', summary.not_reviewed],
          ['Solid', summary.mastered],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      {weakest.length > 0 && summary.reviewed > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Weakest areas</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {weakest.map((r) => (
              <li key={r.requirement_id}>
                {r.text} {r.priority === 'must' && <Badge tone="brand">Must</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mt-4 text-sm font-medium">By requirement</h3>
      <ul className="mt-2 space-y-2">
        {summary.by_requirement
          .filter((r) => r.cards > 0)
          .map((r) => (
            <li key={r.requirement_id} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-slate-700">{r.text}</span>
                <span className="shrink-0 text-slate-500">
                  {r.reviewed}/{r.cards}
                </span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
                role="meter"
                aria-label={`Confidence in ${r.text}`}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={r.confidence ?? 0}
              >
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${((r.confidence ?? 0) / 5) * 100}%` }}
                />
              </div>
            </li>
          ))}
      </ul>
    </Card>
  );
}
