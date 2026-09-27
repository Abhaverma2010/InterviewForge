'use client';

// Company brief (editable, pinnable, regenerable), what research found, and
// the role's requirements with how well the current questions cover them.

import { useState } from 'react';
import { uncoveredRequirements } from '@/lib/format';
import { Alert, Badge, Button, Card, inputClass, useToast } from '../ui';

export function Overview({ editor }) {
  const { record, draft } = editor;
  const kit = record.kit;
  const uncovered = uncoveredRequirements(kit.role.requirements, draft.questions);
  const uncoveredMust = uncovered.filter((r) => r.priority === 'must');

  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-5">
        <BriefCard editor={editor} />
        <RequirementsCard kit={kit} questions={draft.questions} uncoveredMust={uncoveredMust} />
      </div>
      <div className="space-y-5">
        <ResearchCard kit={kit} />
        <CoverageCard kit={kit} uncovered={uncovered} />
      </div>
    </div>
  );
}

function BriefCard({ editor }) {
  const { record, draft, edit, regenerate, busy } = editor;
  const brief = draft.company_brief;
  const stored = record.kit.company_brief;
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const change = (field, value) =>
    edit((d) => ({ ...d, company_brief: { ...d.company_brief, [field]: value } }));

  async function onRegenerate() {
    if (
      stored.edited &&
      !window.confirm('You have edited this brief. Regenerating replaces your edits. Continue?')
    ) {
      return;
    }
    const result = await regenerate({ section: 'brief' });
    toast(
      result.ok
        ? { message: 'Company brief regenerated.' }
        : { message: result.error.message, tone: 'error' },
    );
  }

  return (
    <Card aria-labelledby="brief-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brief-heading" className="font-semibold">
          Company brief
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {stored.edited && <Badge tone="violet">Edited</Badge>}
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={brief.pinned}
            onClick={() => change('pinned', !brief.pinned)}
          >
            {brief.pinned ? '📌 Pinned' : 'Pin'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            busy={busy.brief}
            disabled={brief.pinned}
            title={brief.pinned ? 'Unpin the brief to regenerate it' : 'Research the company again'}
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        </div>
      </div>

      {stored.found === false && (
        <Alert tone="warning" className="mt-3">
          We could not find reliable information about this company, so this brief says so instead of
          guessing.
        </Alert>
      )}

      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium" htmlFor="brief-summary">
            Summary
          </label>
          <textarea
            id="brief-summary"
            rows={5}
            className={inputClass}
            value={brief.summary}
            onChange={(e) => change('summary', e.target.value)}
          />
          <label className="block text-sm font-medium" htmlFor="brief-what">
            What they do
          </label>
          <textarea
            id="brief-what"
            rows={3}
            className={inputClass}
            value={brief.what_they_do}
            onChange={(e) => change('what_they_do', e.target.value)}
          />
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">
          <p>{brief.summary}</p>
          <p>
            <span className="font-medium text-slate-900">What they do: </span>
            {brief.what_they_do}
          </p>
        </div>
      )}

      {stored.sources?.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Sources:{' '}
          {stored.sources.map((url, i) => (
            <span key={url}>
              {i > 0 && ', '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-slate-700"
              >
                {shortUrl(url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}

function ResearchCard({ kit }) {
  const research = kit.company_brief.research ?? {};
  const hiring = kit.company_brief.hiring_process ?? { stages: [], notes: [] };
  const discussion = research.discussion ?? { results: [] };

  return (
    <Card aria-labelledby="research-heading">
      <h2 id="research-heading" className="font-semibold">
        What we found
      </h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-slate-900">Company site</dt>
          <dd className="text-slate-700">
            {research.site_reachable ? (
              `${research.pages_crawled?.length ?? 0} page(s) read`
            ) : (
              <span className="text-amber-800">Could not be reached ({research.site_error?.code})</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">Hiring page</dt>
          <dd className="text-slate-700">
            {research.hiring_page ? (
              <a
                href={research.hiring_page}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline"
              >
                {shortUrl(research.hiring_page)}
              </a>
            ) : (
              'None found on the site'
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">Interview process</dt>
          <dd className="text-slate-700">
            {hiring.found ? (
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {hiring.stages.map((s) => (
                  <li key={s.name}>
                    <span className="font-medium">{s.name}</span>
                    {s.description && <span className="text-slate-600">: {s.description}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              'Not published; questions are based on the role alone'
            )}
            {hiring.notes?.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {hiring.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-900">Public discussion</dt>
          <dd className="text-slate-700">
            {discussion.error
              ? `Search failed (${discussion.error.code})`
              : discussion.results.length
                ? `${discussion.results.length} thread(s) on Hacker News`
                : 'Nothing found'}
            {discussion.results.length > 0 && (
              <ul className="mt-1 space-y-1 text-xs">
                {discussion.results.slice(0, 4).map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline">
                      {d.title || d.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {research.skipped_sources?.length > 0 && (
          <div>
            <dt className="font-medium text-slate-900">Skipped sources</dt>
            <dd>
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">
                  {research.skipped_sources.length} page(s) could not be used
                </summary>
                <ul className="mt-1 space-y-1">
                  {research.skipped_sources.map((s) => (
                    <li key={s.url} className="break-all">
                      {s.code}: {s.url}
                    </li>
                  ))}
                </ul>
              </details>
            </dd>
          </div>
        )}
      </dl>
      {kit.meta?.warnings?.length > 0 && (
        <details className="mt-4 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">
            Generation notes ({kit.meta.warnings.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {kit.meta.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function RequirementsCard({ kit, questions, uncoveredMust }) {
  const { role } = kit;
  const count = (id) => questions.filter((q) => q.requirement_ids.includes(id)).length;

  return (
    <Card aria-labelledby="req-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="req-heading" className="font-semibold">
          What the role requires
        </h2>
        <p className="text-xs text-slate-500">
          {role.seniority !== 'Not stated' && `${role.seniority} · `}
          {role.requirements.length} requirement{role.requirements.length === 1 ? '' : 's'}
        </p>
      </div>

      {role.thin && (
        <Alert tone="info" className="mt-3" title="This posting says little">
          {role.notes?.[0] ?? 'The kit covers only what the posting states.'} We have not added requirements
          it does not mention.
        </Alert>
      )}
      {uncoveredMust.length > 0 && (
        <Alert tone="warning" className="mt-3">
          {uncoveredMust.length} must-have requirement{uncoveredMust.length === 1 ? ' has' : 's have'} no
          question after your edits. Add a question for it or regenerate a category.
        </Alert>
      )}

      {role.requirements.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">The posting did not state any concrete requirements.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {role.requirements.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
              <span className="w-7 shrink-0 font-mono text-xs text-slate-400">{r.id}</span>
              <span className="min-w-0 flex-1 basis-[calc(100%-2.25rem)] sm:basis-0">{r.text}</span>
              <span className="w-7 shrink-0 sm:hidden" aria-hidden="true" />
              <Badge tone={r.priority === 'must' ? 'brand' : 'slate'}>
                {r.priority === 'must' ? 'Must' : 'Nice'}
              </Badge>
              <Badge>{r.kind}</Badge>
              <span
                className={`w-20 text-right text-xs ${count(r.id) ? 'text-slate-500' : 'font-semibold text-amber-700'}`}
              >
                {count(r.id)} question{count(r.id) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {role.responsibilities?.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Responsibilities ({role.responsibilities.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
            {role.responsibilities.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {role.dropped_requirements?.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">
            {role.dropped_requirements.length} suggestion(s) dropped because the posting does not state them
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {role.dropped_requirements.map((d) => (
              <li key={d.text}>{d.text}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function CoverageCard({ kit, uncovered }) {
  const { coverage } = kit;
  return (
    <Card aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="font-semibold">
        Coverage check
      </h2>
      <p className="mt-2 text-sm text-slate-700">
        {uncovered.length === 0
          ? 'Every requirement has at least one question.'
          : `${uncovered.length} requirement(s) without a question: ${uncovered.map((r) => r.id).join(', ')}.`}
      </p>
      {coverage.history?.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs text-slate-600">
          {coverage.history.map((h) => (
            <li key={h.pass}>
              Pass {h.pass}:{' '}
              {h.uncovered_requirement_ids.length
                ? `uncovered ${h.uncovered_requirement_ids.join(', ')}${h.pass < coverage.history.length ? ' → asked for targeted questions' : ''}`
                : 'all covered'}
            </li>
          ))}
        </ol>
      )}
      {coverage.template_filled_requirement_ids?.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Template questions were added for {coverage.template_filled_requirement_ids.join(', ')} when the
          model would not cover them.
        </p>
      )}
    </Card>
  );
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}
