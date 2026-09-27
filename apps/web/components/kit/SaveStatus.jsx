'use client';

import { Spinner } from '../ui';

// Tells the user, quietly, whether their edits are safe.
export function SaveStatus({ status, onRetry }) {
  const content = {
    saved: <span className="text-slate-500">All changes saved</span>,
    pending: <span className="text-slate-500">Unsaved changes…</span>,
    saving: (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <Spinner className="h-3.5 w-3.5" /> Saving…
      </span>
    ),
    invalid: <span className="text-amber-700">Not saved: {status.message}</span>,
    error: (
      <span className="text-red-700">
        Not saved: {status.message}{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      </span>
    ),
  }[status.state];

  return (
    <p className="text-xs" role="status" aria-live="polite">
      {content}
    </p>
  );
}
