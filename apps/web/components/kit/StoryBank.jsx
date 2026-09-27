'use client';

// Story bank: write your few real stories once, tag what each one shows, and
// see which story answers which question, which questions have no story, and
// which story you are leaning on too much. The matching is done by the API
// (core/stories/story-bank.js) and arrives with every save as insights.

import { useState } from 'react';
import { tempId } from '@/lib/kit-sync';
import { Alert, Badge, Button, Card, EmptyState, inputClass, useToast } from '../ui';

export function StoryBank({ editor }) {
  const { draft, edit, record, status } = editor;
  const insights = record.insights?.stories;
  const requirements = record.kit.role.requirements;
  const reqById = Object.fromEntries(requirements.map((r) => [r.id, r]));
  const questionById = Object.fromEntries(draft.questions.map((q) => [q.id, q]));
  const storyById = Object.fromEntries(draft.stories.map((s) => [s.id, s]));
  const toast = useToast();
  const [editingId, setEditingId] = useState(null);
  const updating = status.state === 'pending' || status.state === 'saving';

  const setStories = (fn) => edit((d) => ({ ...d, stories: fn(d.stories) }));
  const update = (id, changes) =>
    setStories((all) => all.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const uses = {};
  for (const entry of insights?.questions ?? [])
    for (const sid of entry.story_ids) uses[sid] = (uses[sid] ?? 0) + 1;
  const overused = new Set((insights?.overused ?? []).map((o) => o.story_id));

  function add() {
    const story = {
      id: tempId('s'),
      title: '',
      situation: '',
      action: '',
      result: '',
      requirement_ids: requirements
        .filter((r) => r.kind === 'behavioural')
        .slice(0, 1)
        .map((r) => r.id),
      question_ids: [],
    };
    setStories((all) => [...all, story]);
    setEditingId(story.id);
  }

  function remove(id) {
    const index = draft.stories.findIndex((s) => s.id === id);
    const removed = draft.stories[index];
    setStories((all) => all.filter((s) => s.id !== id));
    toast({
      message: 'Story deleted.',
      action: {
        label: 'Undo',
        onClick: () =>
          setStories((all) =>
            all.some((s) => s.id === removed.id)
              ? all
              : [...all.slice(0, index), removed, ...all.slice(index)],
          ),
      },
    });
  }

  const link = (storyId, questionId) =>
    setStories((all) =>
      all.map((s) =>
        s.id === storyId && !s.question_ids.includes(questionId)
          ? { ...s, question_ids: [...s.question_ids, questionId] }
          : s,
      ),
    );
  const unlink = (storyId, questionId) =>
    setStories((all) =>
      all.map((s) =>
        s.id === storyId ? { ...s, question_ids: s.question_ids.filter((id) => id !== questionId) } : s,
      ),
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section aria-labelledby="stories-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="stories-heading" className="font-semibold">
              Your stories
            </h2>
            <p className="text-xs text-slate-500">
              Most people have 4–5 good stories. Write each once and tag what it shows.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={add}>
            + Add a story
          </Button>
        </div>

        {draft.stories.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No stories yet" action={<Button onClick={add}>Write your first story</Button>}>
              Think of a project that went wrong, a time you helped someone grow, a disagreement you handled.
              We&apos;ll show which interview questions each one answers.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {draft.stories.map((story) => (
              <li key={story.id}>
                <Card className="!p-4">
                  {editingId === story.id ? (
                    <StoryForm
                      story={story}
                      requirements={requirements}
                      onChange={(c) => update(story.id, c)}
                      onDone={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-medium">
                          {story.title || <span className="italic text-slate-400">Untitled story</span>}
                        </h3>
                        <Badge tone={overused.has(story.id) ? 'amber' : uses[story.id] ? 'green' : 'slate'}>
                          {uses[story.id]
                            ? `Answers ${uses[story.id]} question${uses[story.id] === 1 ? '' : 's'}`
                            : 'Not used yet'}
                        </Badge>
                      </div>
                      {overused.has(story.id) && (
                        <p className="mt-1 text-xs text-amber-800">
                          You lean on this story a lot. Interviewers notice repeats; prepare a second one for
                          some of these.
                        </p>
                      )}
                      <dl className="mt-2 space-y-1 text-sm text-slate-700">
                        {[
                          ['Situation', story.situation],
                          ['Action', story.action],
                          ['Result', story.result],
                        ]
                          .filter(([, v]) => v)
                          .map(([label, value]) => (
                            <div key={label}>
                              <dt className="inline font-medium text-slate-900">{label}: </dt>
                              <dd className="inline">{value}</dd>
                            </div>
                          ))}
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {story.requirement_ids.map((id) => (
                          <Badge key={id} tone="brand" title={reqById[id]?.text}>
                            {reqById[id]?.text ?? id}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-1 border-t border-slate-100 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(story.id)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto text-red-700"
                          onClick={() => remove(story.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="coverage-stories-heading">
        <h2 id="coverage-stories-heading" className="font-semibold">
          Which story answers which question
        </h2>
        <p className="text-xs text-slate-500" aria-live="polite">
          {insights ? `${insights.covered} of ${insights.total} story questions have a story.` : ''}
          {updating && ' Updating…'}
        </p>

        {insights?.requirementsWithoutStory.length > 0 && (
          <Alert tone="warning" className="mt-3">
            No story shows yet:{' '}
            {insights.requirementsWithoutStory.map((id) => reqById[id]?.text ?? id).join(', ')}.
          </Alert>
        )}

        <ul className="mt-3 space-y-2">
          {(insights?.questions ?? [])
            .filter((entry) => questionById[entry.question_id])
            .map((entry) => {
              const question = questionById[entry.question_id];
              return (
                <li
                  key={entry.question_id}
                  className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm"
                >
                  <p className="font-medium text-slate-900">{question.prompt}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {entry.story_ids.length === 0 && <Badge tone="red">No story yet</Badge>}
                    {entry.story_ids
                      .filter((sid) => storyById[sid])
                      .map((sid) => (
                        <span
                          key={sid}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                        >
                          {storyById[sid].title || 'Untitled'}
                          <span className="text-emerald-700/70">
                            ({entry.via[sid] === 'linked' ? 'linked' : 'shared skill'})
                          </span>
                          {entry.via[sid] === 'linked' && (
                            <button
                              type="button"
                              aria-label={`Unlink ${storyById[sid].title}`}
                              className="ml-0.5 hover:text-emerald-950"
                              onClick={() => unlink(sid, entry.question_id)}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                    {draft.stories.length > 0 && (
                      <>
                        <label className="sr-only" htmlFor={`link-${entry.question_id}`}>
                          Link a story to this question
                        </label>
                        <select
                          id={`link-${entry.question_id}`}
                          value=""
                          onChange={(e) => e.target.value && link(e.target.value, entry.question_id)}
                          className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600"
                        >
                          <option value="">Link a story…</option>
                          {draft.stories
                            .filter((s) => !entry.story_ids.includes(s.id) && s.title)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                        </select>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}

function StoryForm({ story, requirements, onChange, onDone }) {
  const toggle = (id) =>
    onChange({
      requirement_ids: story.requirement_ids.includes(id)
        ? story.requirement_ids.filter((r) => r !== id)
        : [...story.requirement_ids, id],
    });
  const field = (key, label, rows, placeholder) => (
    <div>
      <label htmlFor={`${key}-${story.id}`} className="text-xs font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={`${key}-${story.id}`}
        rows={rows}
        className={`${inputClass} mt-1`}
        value={story[key]}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </div>
  );
  // Behavioural requirements first: they are what stories are for.
  const ordered = [...requirements].sort(
    (a, b) => (a.kind === 'behavioural' ? -1 : 0) - (b.kind === 'behavioural' ? -1 : 0),
  );

  return (
    <div className="space-y-3" onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <div>
        <label htmlFor={`title-${story.id}`} className="text-xs font-medium text-slate-700">
          Title
        </label>
        <input
          id={`title-${story.id}`}
          autoFocus
          className={`${inputClass} mt-1`}
          value={story.title}
          placeholder="e.g. The payments outage on Black Friday"
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      {field('situation', 'Situation (and your task)', 2, 'The context and what was at stake')}
      {field('action', 'Action', 3, 'What you did, specifically')}
      {field('result', 'Result', 2, 'The outcome, with a number if you can')}
      <fieldset>
        <legend className="text-xs font-medium text-slate-700">What this story shows</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {ordered.map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={story.requirement_ids.includes(r.id)}
                onChange={() => toggle(r.id)}
              />
              <span>
                {r.text}{' '}
                {r.kind === 'behavioural' && <span className="text-xs text-slate-400">(behavioural)</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
