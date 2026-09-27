'use client';

// A kit: progress while it generates, the error if it failed, the builder
// once it is ready.

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { GenerationProgress } from '@/components/GenerationProgress';
import { KitView } from '@/components/kit/KitView';
import { Alert, Button, ButtonLink, EmptyState, PageLoading } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

const POLL_MS = 2000;

export default function KitPage() {
  const user = useRequireAuth();
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const loadRecord = useCallback(async () => {
    try {
      const res = await api(`/kits/${id}`);
      setRecord(res.kit);
      setStatus({ status: res.kit.status, progress: res.kit.progress, error: res.kit.error });
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    if (user) loadRecord();
  }, [user, loadRecord]);

  // Poll the lightweight status endpoint while generating; load the full kit when done.
  const generating = status && (status.status === 'queued' || status.status === 'generating');
  useEffect(() => {
    if (!generating) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await api(`/kits/${id}/status`);
        if (cancelled) return;
        setStatus(next);
        if (next.status === 'ready' || next.status === 'failed') loadRecord();
      } catch (err) {
        if (!cancelled && err.code !== 'NETWORK') setError(err);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [generating, id, loadRecord]);

  async function retry() {
    setRetrying(true);
    try {
      await api(`/kits/${id}/retry`, { method: 'POST' });
      setStatus({ status: 'queued', progress: null, error: null });
    } catch (err) {
      setError(err);
    } finally {
      setRetrying(false);
    }
  }

  if (error?.code === 'KIT_NOT_FOUND') {
    return (
      <EmptyState title="Kit not found" action={<ButtonLink href="/kits">Back to my kits</ButtonLink>}>
        It may have been deleted, or it belongs to another account.
      </EmptyState>
    );
  }
  if (error && !record) {
    return (
      <Alert
        tone="error"
        title="Could not load this kit"
        action={
          <Button size="sm" variant="secondary" onClick={loadRecord}>
            Try again
          </Button>
        }
      >
        {error.message}
      </Alert>
    );
  }
  if (!user || !status) return <PageLoading label="Loading kit…" />;

  if (generating) return <GenerationProgress status={status} />;

  if (status.status === 'failed') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert
          tone="error"
          title="We could not build this kit"
          action={
            <Button size="sm" busy={retrying} onClick={retry}>
              Try again
            </Button>
          }
        >
          <p>{status.error?.message}</p>
          <p className="mt-1 text-xs opacity-75">Code: {status.error?.code}</p>
        </Alert>
        <p className="text-sm text-slate-600">
          This usually means the AI provider was unavailable or out of quota. Nothing is lost: trying again
          re-runs the research and generation.
        </p>
      </div>
    );
  }

  if (!record || record.status !== 'ready') return <PageLoading label="Loading kit…" />;
  return <KitView key={record.id} initialRecord={record} />;
}
