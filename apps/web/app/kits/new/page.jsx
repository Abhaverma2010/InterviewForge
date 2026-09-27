'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, ButtonLink, Card, Field, inputClass, PageLoading } from '@/components/ui';
import { api, fieldErrors } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { MAX_BATCH, parseBatchFile } from '@/lib/batch-file';

export default function NewKitPage() {
  const user = useRequireAuth();
  const [mode, setMode] = useState('single');
  if (!user) return <PageLoading />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">New prep kit</h1>
      <p className="mt-1 text-sm text-slate-600">
        We research the company, extract what the role requires and build your kit. It takes a minute or two,
        and you can leave the page while it works.
      </p>

      <div
        role="tablist"
        aria-label="How many roles"
        className="mt-5 inline-flex rounded-lg bg-slate-200/70 p-1"
      >
        {[
          ['single', 'One role'],
          ['batch', 'Several roles (upload a file)'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 aria-selected:bg-white aria-selected:text-slate-900 aria-selected:shadow-sm"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">{mode === 'single' ? <SingleForm /> : <BatchForm />}</div>
    </div>
  );
}

function SingleForm() {
  const router = useRouter();
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState('7');
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(force = false) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api('/kits', {
        method: 'POST',
        body: { jd, company_url: companyUrl, days: Number(days), ...(force && { force: true }) },
      });
      if (res.duplicate) {
        setDuplicate(res.kit);
        setSubmitting(false);
        return;
      }
      router.push(`/kits/${res.kit.id}`);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  const fields = fieldErrors(error);
  const jdChars = jd.trim().length;

  return (
    <Card>
      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && !Object.keys(fields).length && <Alert tone="error">{error.message}</Alert>}
        {duplicate && (
          <Alert
            tone="warning"
            title="You already have a kit for this posting"
            action={
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/kits/${duplicate.id}`} size="sm">
                  Open it
                </ButtonLink>
                <Button size="sm" variant="secondary" busy={submitting} onClick={() => submit(true)}>
                  Generate a new one anyway
                </Button>
              </div>
            }
          >
            {duplicate.title} at {duplicate.company} ({duplicate.status}).
          </Alert>
        )}

        <Field
          id="jd"
          label="Job description"
          hint="Paste the whole posting. A short posting makes a short kit; we never invent requirements."
          error={fields.jd}
        >
          {(props) => (
            <>
              <textarea
                {...props}
                rows={12}
                className={`${inputClass} font-mono text-[13px] leading-relaxed`}
                placeholder={'Senior Backend Engineer\n\nRequirements\n- 5+ years with Go\n…'}
                value={jd}
                onChange={(e) => {
                  setJd(e.target.value);
                  setDuplicate(null);
                }}
              />
              <p className="mt-1 text-right text-xs text-slate-500">{jdChars.toLocaleString()} characters</p>
            </>
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <Field
            id="company_url"
            label="Company website"
            hint="We crawl it to learn what they do and how they hire."
            error={fields.company_url}
          >
            {(props) => (
              <input
                {...props}
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                className={inputClass}
                value={companyUrl}
                onChange={(e) => {
                  setCompanyUrl(e.target.value);
                  setDuplicate(null);
                }}
              />
            )}
          </Field>
          <Field id="days" label="Days until interview" error={fields.days}>
            {(props) => (
              <input
                {...props}
                type="number"
                min={1}
                max={365}
                className={inputClass}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" busy={submitting}>
            Build my kit
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BatchForm() {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [defaultDays, setDefaultDays] = useState('7');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onFile(event) {
    const chosen = event.target.files?.[0];
    setResults(null);
    setError(null);
    if (!chosen) return;
    if (chosen.size > 1_000_000) {
      setParsed({ items: [], errors: ['The file is larger than 1 MB.'] });
      return;
    }
    const text = await chosen.text();
    setFile({ name: chosen.name, text });
    setParsed(parseBatchFile(chosen.name, text, { defaultDays: Number(defaultDays) || 7 }));
  }

  function changeDefaultDays(value) {
    setDefaultDays(value);
    if (file) setParsed(parseBatchFile(file.name, file.text, { defaultDays: Number(value) || 7 }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api('/kits/batch', { method: 'POST', body: { items: parsed.items } });
      setResults(res.results);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="space-y-5">
        <div className="text-sm text-slate-700">
          <p>
            Upload a <strong>.json</strong> file (an array of <code>{'{ jd, company_url, days }'}</code>, the
            same format as the batch evaluator) or a <strong>.csv</strong> with columns{' '}
            <code>jd,company_url,days</code>. Up to {MAX_BATCH} roles at a time.
          </p>
          <p className="mt-1">
            <a href="/sample-roles.json" download className="font-medium text-brand-700 hover:underline">
              Download a sample file
            </a>
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <Field id="file" label="File">
            {(props) => (
              <input
                {...props}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={onFile}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
            )}
          </Field>
          <Field id="default-days" label="Days, if a row has none">
            {(props) => (
              <input
                {...props}
                type="number"
                min={1}
                max={365}
                className={inputClass}
                value={defaultDays}
                onChange={(e) => changeDefaultDays(e.target.value)}
              />
            )}
          </Field>
        </div>

        {parsed?.errors.length > 0 && (
          <Alert tone={parsed.items.length ? 'warning' : 'error'} title="Some rows need attention">
            <ul className="list-disc pl-5">
              {parsed.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}

        {parsed?.items.length > 0 && !results && (
          <div>
            <p className="text-sm font-medium">
              {parsed.items.length} role{parsed.items.length === 1 ? '' : 's'} ready
            </p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {parsed.items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{item.jd.split('\n').find((l) => l.trim())}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {item.company_url} · {item.days}d
                  </span>
                </li>
              ))}
            </ul>
            {error && (
              <Alert tone="error" className="mt-3">
                {error.message}
              </Alert>
            )}
            <div className="mt-4 flex justify-end">
              <Button busy={submitting} onClick={submit}>
                Build {parsed.items.length} kit{parsed.items.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            <Alert tone="success" title="Your kits are being built">
              They generate one or two at a time; you can follow them on your kits page.
            </Alert>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {results.map((r) => (
                <li key={r.index} className="flex items-center justify-between gap-3 px-3 py-2">
                  {r.kit ? (
                    <>
                      <Link
                        href={`/kits/${r.kit.id}`}
                        className="min-w-0 truncate text-brand-700 hover:underline"
                      >
                        {r.kit.title}
                      </Link>
                      <span className="shrink-0 text-xs text-slate-500">
                        {r.duplicate ? 'already existed' : 'queued'}
                      </span>
                    </>
                  ) : (
                    <span className="text-red-700">
                      Row {r.index + 1}: {r.error.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={() => router.push('/kits')}>Go to my kits</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
