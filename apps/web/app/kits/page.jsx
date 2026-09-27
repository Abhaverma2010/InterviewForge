'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, EmptyState, PageLoading, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { stepLabel, timeAgo } from '@/lib/format';

const STATUS = {
  queued: { tone: 'slate', label: 'Queued' },
  generating: { tone: 'brand', label: 'Generating' },
  ready: { tone: 'green', label: 'Ready' },
  failed: { tone: 'red', label: 'Failed' },
};

export default function KitsPage() {
  const user = useRequireAuth();
  const toast = useToast();
  const [kits, setKits] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api('/kits');
      setKits(res.kits);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Keep the list fresh while anything is still generating.
  const inProgress = kits?.some((k) => k.status === 'queued' || k.status === 'generating');
  useEffect(() => {
    if (!inProgress) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [inProgress, load]);

  async function remove(kit) {
    if (!window.confirm(`Delete the kit for "${kit.title}"? This cannot be undone.`)) return;
    try {
      await api(`/kits/${kit.id}`, { method: 'DELETE' });
      setKits((all) => all.filter((k) => k.id !== kit.id));
      toast({ message: 'Kit deleted.' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  if (!user || (!kits && !error)) return <PageLoading label="Loading your kits…" />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">My prep kits</h1>
        <ButtonLink href="/kits/new">New kit</ButtonLink>
      </div>

      {error && (
        <Alert
          tone="error"
          className="mt-4"
          action={
            <Button size="sm" variant="secondary" onClick={load}>
              Try again
            </Button>
          }
        >
          Could not load your kits: {error.message}
        </Alert>
      )}

      {kits && kits.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No kits yet"
            action={<ButtonLink href="/kits/new">Create your first kit</ButtonLink>}
          >
            Paste a job description and the company&apos;s website, say how many days you have, and we&apos;ll
            build your prep kit.
          </EmptyState>
        </div>
      )}

      {kits && kits.length > 0 && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {kits.map((kit) => (
            <li key={kit.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/kits/${kit.id}`}
                    className="block truncate font-semibold text-slate-900 hover:text-brand-700 hover:underline"
                  >
                    {kit.title}
                  </Link>
                  <p className="truncate text-sm text-slate-600">{kit.company}</p>
                </div>
                <Badge tone={STATUS[kit.status].tone}>{STATUS[kit.status].label}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {kit.days} day{kit.days === 1 ? '' : 's'} · created {timeAgo(kit.created_at)}
                {kit.thin && ' · thin posting'}
              </p>
              {kit.status === 'generating' && kit.progress?.current && (
                <p className="mt-2 text-xs text-brand-700">{stepLabel(kit.progress.current)}…</p>
              )}
              {kit.status === 'failed' && <p className="mt-2 text-xs text-red-700">{kit.error?.message}</p>}
              <div className="mt-3 flex gap-2">
                <ButtonLink href={`/kits/${kit.id}`} variant="secondary" size="sm">
                  {kit.status === 'ready' ? 'Open' : 'View progress'}
                </ButtonLink>
                {kit.status === 'ready' && (
                  <ButtonLink href={`/kits/${kit.id}/practice`} variant="ghost" size="sm">
                    Practise
                  </ButtonLink>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-red-700"
                  onClick={() => remove(kit)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
