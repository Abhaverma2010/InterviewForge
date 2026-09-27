'use client';

import { useState } from 'react';
import { CATEGORIES, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/format';
import { Badge, Button, inputClass } from '../ui';

export function QuestionCard({
  question: q,
  requirements,
  handle,
  editing,
  onEditingChange,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMoveToCategory,
}) {
  const [showOutline, setShowOutline] = useState(false);
  const reqById = Object.fromEntries(requirements.map((r) => [r.id, r]));

  return (
    <article
      className={`rounded-lg border bg-white p-3 shadow-sm ${q.pinned ? 'border-brand-200' : 'border-slate-200'}`}
      aria-label={`Question: ${q.prompt || 'new question'}`}
    >
      <div className="flex gap-2">
        <button
          type="button"
          {...handle}
          aria-label="Drag to reorder or move to another category"
          className="mt-0.5 h-7 w-6 shrink-0 cursor-grab touch-none rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
        >
          ⋮⋮
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <EditForm
              q={q}
              requirements={requirements}
              onChange={onChange}
              onDone={() => onEditingChange(false)}
            />
          ) : (
            <>
              <p className="text-sm font-medium text-slate-900">
                {q.prompt || <span className="italic text-slate-400">Empty question</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={q.difficulty === 3 ? 'amber' : 'slate'} title="Difficulty">
                  {DIFFICULTY_LABELS[q.difficulty]}
                </Badge>
                {q.requirement_ids.map((id) => (
                  <Badge key={id} tone="brand" title={reqById[id]?.text}>
                    {id}: {truncate(reqById[id]?.text ?? '', 28)}
                  </Badge>
                ))}
                {q.origin === 'user' && <Badge tone="violet">Yours</Badge>}
                {q.origin === 'template' && (
                  <Badge title="Written by code when the model left a gap">Template</Badge>
                )}
                {q.edited && <Badge tone="violet">Edited</Badge>}
                {q.pinned && <Badge tone="brand">Pinned</Badge>}
              </div>
              {q.answer_outline && (
                <div className="mt-2">
                  <button
                    type="button"
                    aria-expanded={showOutline}
                    onClick={() => setShowOutline((v) => !v)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    {showOutline ? 'Hide' : 'Show'} answer outline
                  </button>
                  {showOutline && (
                    <p className="mt-1 whitespace-pre-line rounded-md bg-slate-50 p-2 text-sm text-slate-700">
                      {q.answer_outline}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {!editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onEditingChange(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={q.pinned}
            onClick={() => onChange({ pinned: !q.pinned })}
          >
            {q.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button variant="ghost" size="sm" disabled={!onMoveUp} onClick={onMoveUp} aria-label="Move up">
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!onMoveDown}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            ↓
          </Button>
          <label className="sr-only" htmlFor={`move-${q.id}`}>
            Move to category
          </label>
          <select
            id={`move-${q.id}`}
            value=""
            onChange={(e) => e.target.value && onMoveToCategory(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600"
          >
            <option value="">Move to…</option>
            {CATEGORIES.filter((c) => c !== q.category).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" className="ml-auto text-red-700" onClick={onDelete}>
            Delete
          </Button>
        </div>
      )}
    </article>
  );
}

function EditForm({ q, requirements, onChange, onDone }) {
  const toggleRequirement = (id) =>
    onChange({
      requirement_ids: q.requirement_ids.includes(id)
        ? q.requirement_ids.filter((r) => r !== id)
        : [...q.requirement_ids, id],
    });

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone();
      }}
    >
      <div>
        <label htmlFor={`prompt-${q.id}`} className="text-xs font-medium text-slate-700">
          Question
        </label>
        <textarea
          id={`prompt-${q.id}`}
          rows={3}
          autoFocus
          className={`${inputClass} mt-1`}
          value={q.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="What would the interviewer ask?"
        />
      </div>
      <div>
        <label htmlFor={`outline-${q.id}`} className="text-xs font-medium text-slate-700">
          Answer outline
        </label>
        <textarea
          id={`outline-${q.id}`}
          rows={4}
          className={`${inputClass} mt-1`}
          value={q.answer_outline}
          onChange={(e) => onChange({ answer_outline: e.target.value })}
          placeholder={'- Point one\n- Point two'}
        />
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-slate-700">Difficulty</legend>
        <div className="mt-1 flex gap-3">
          {[1, 2, 3].map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={`difficulty-${q.id}`}
                checked={q.difficulty === d}
                onChange={() => onChange({ difficulty: d })}
              />
              {DIFFICULTY_LABELS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      {requirements.length > 0 && (
        <fieldset>
          <legend className="text-xs font-medium text-slate-700">Requirements this question covers</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {requirements.map((r) => (
              <label key={r.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={q.requirement_ids.includes(r.id)}
                  onChange={() => toggleRequirement(r.id)}
                />
                <span>
                  <span className="font-mono text-xs text-slate-400">{r.id}</span> {r.text}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
