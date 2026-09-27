'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldErrors } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Field, inputClass } from './ui';

export function AuthForm({ mode }) {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const isLogin = mode === 'login';

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await (isLogin ? login : register)(email, password);
      router.replace(next);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  const fields = fieldErrors(error);
  const formError = error && !Object.keys(fields).length ? error.message : null;

  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="text-2xl font-bold tracking-tight">{isLogin ? 'Log in' : 'Create your account'}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {isLogin ? 'Pick up your prep kits where you left them.' : 'Your kits are private to your account.'}
      </p>
      {params.get('expired') && (
        <Alert tone="warning" className="mt-4">
          Your session expired. Please log in again.
        </Alert>
      )}
      <Card className="mt-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Field id="email" label="Email" error={fields.email}>
            {(props) => (
              <input
                {...props}
                type="email"
                autoComplete="email"
                required
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field
            id="password"
            label="Password"
            hint={isLogin ? undefined : 'At least 8 characters.'}
            error={fields.password}
          >
            {(props) => (
              <input
                {...props}
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" busy={submitting} className="w-full">
            {isLogin ? 'Log in' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        {isLogin ? 'New here? ' : 'Already have an account? '}
        <Link
          href={`${isLogin ? '/register' : '/login'}${next !== '/kits' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-brand-700 hover:underline"
        >
          {isLogin ? 'Create an account' : 'Log in'}
        </Link>
      </p>
    </div>
  );
}

// Only same-site paths, so a crafted link cannot bounce the user elsewhere.
function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/kits';
}
