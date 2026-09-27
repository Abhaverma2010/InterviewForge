'use client';

// Small shared building blocks, so pages stay readable and states (loading,
// empty, error) look the same everywhere.

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const BUTTON_STYLES = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-200/70 disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
};
const BUTTON_SIZES = { sm: 'px-2.5 py-1 text-sm', md: 'px-4 py-2 text-sm' };

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_STYLES[variant]} ${BUTTON_SIZES[size]} ${className}`}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', size = 'md', className = '', children }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ${BUTTON_STYLES[variant]} ${BUTTON_SIZES[size]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-slate-500" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

const ALERT_STYLES = {
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-brand-100 bg-brand-50 text-slate-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export function Alert({ tone = 'info', title, children, action, className = '' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${ALERT_STYLES[tone]} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const BADGE_STYLES = {
  slate: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-100 text-brand-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800',
  violet: 'bg-violet-100 text-violet-800',
};

export function Badge({ tone = 'slate', children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

/** A labelled form control with an optional hint and error, wired for screen readers. */
export function Field({ id, label, hint, error, children }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      <div className="mt-1.5">
        {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined })}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-red-400';

// ─── Toasts ──────────────────────────────────────────────────────────────────

const ToastContext = createContext(() => {});

/** Brief messages at the bottom of the screen, optionally with an action (e.g. Undo). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    ({ message, tone = 'info', action, duration = 6000 }) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((all) => [...all.slice(-2), { id, message, tone, action }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ${
              t.tone === 'error' ? 'bg-red-700 text-white' : 'bg-slate-900 text-white'
            }`}
          >
            <span>{t.message}</span>
            <div className="flex shrink-0 gap-2">
              {t.action && (
                <button
                  type="button"
                  className="font-semibold text-brand-100 underline-offset-2 hover:underline"
                  onClick={() => {
                    t.action.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                className="text-white/70 hover:text-white"
                onClick={() => dismiss(t.id)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
