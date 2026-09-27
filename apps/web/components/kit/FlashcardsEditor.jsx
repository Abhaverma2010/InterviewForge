'use client';

import { useState } from 'react';
import { tempId } from '@/lib/kit-sync';
import { Badge, Button, ButtonLink, EmptyState, inputClass, useToast } from '../ui';

export function FlashcardsEditor({ editor }) {
  const { draft, edit, record } = editor;
  const requirements = record.kit.role.requirements;
  const reqById = Object.fromEntries(requirements.map((r) => [r.id, r]));
  const toast = useToast();
  const [editingId, setEditingId] = useState(null);

  const setCards = (fn) => edit((d) => ({ ...d, flashcards: fn(d.flashcards) }));
  const update = (id, changes) =>
    setCards((cards) => cards.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  function add() {
    const card = {
      id: tempId('f'),
      front: '',
      back: '',
      requirement_ids: [],
      pinned: false,
      origin: 'user',
      edited: false,
    };
    setCards((cards) => [...cards, card]);
    setEditingId(card.id);
  }

  function remove(id) {
    const index = draft.flashcards.findIndex((c) => c.id === id);
    const removed = draft.flashcards[index];
    setCards((cards) => cards.filter((c) => c.id !== id));
    toast({
      message: 'Flashcard deleted.',
      action: {
        label: 'Undo',
        onClick: () =>
          setCards((cards) =>
            cards.some((c) => c.id === removed.id)
              ? cards
              : [...cards.slice(0, index), removed, ...cards.slice(index)],
          ),
      },
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Short recall cards. Practise them one at a time in practice mode.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={add}>
            + Add flashcard
          </Button>
          <ButtonLink href={`/kits/${record.id}/practice`} size="sm">
            Practise
          </ButtonLink>
        </div>
      </div>

      {draft.flashcards.length === 0 ? (
        <EmptyState title="No flashcards" action={<Button onClick={add}>Add a flashcard</Button>}>
          Add cards for facts and talking points you want to recall quickly.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {draft.flashcards.map((card) => (
            <li
              key={card.id}
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              {editingId === card.id ? (
                <div className="space-y-2" onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}>
                  <label htmlFor={`front-${card.id}`} className="text-xs font-medium text-slate-700">
                    Front
                  </label>
                  <textarea
                    id={`front-${card.id}`}
                    autoFocus
                    rows={2}
                    className={inputClass}
                    value={card.front}
                    onChange={(e) => update(card.id, { front: e.target.value })}
                  />
                  <label htmlFor={`back-${card.id}`} className="text-xs font-medium text-slate-700">
                    Back
                  </label>
                  <textarea
                    id={`back-${card.id}`}
                    rows={3}
                    className={inputClass}
                    value={card.back}
                    onChange={(e) => update(card.id, { back: e.target.value })}
                  />
                  <label htmlFor={`req-${card.id}`} className="text-xs font-medium text-slate-700">
                    Requirement
                  </label>
                  <select
                    id={`req-${card.id}`}
                    className={inputClass}
                    value={card.requirement_ids[0] ?? ''}
                    onChange={(e) =>
                      update(card.id, { requirement_ids: e.target.value ? [e.target.value] : [] })
                    }
                  >
                    <option value="">None</option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}: {r.text}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setEditingId(null)}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {card.front || <span className="italic text-slate-400">Empty front</span>}
                  </p>
                  <p className="mt-2 flex-1 whitespace-pre-line text-sm text-slate-600">
                    {card.back || <span className="italic text-slate-400">Empty back</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {card.requirement_ids.map((id) => (
                      <Badge key={id} tone="brand" title={reqById[id]?.text}>
                        {id}
                      </Badge>
                    ))}
                    {card.origin === 'user' && <Badge tone="violet">Yours</Badge>}
                    {card.edited && <Badge tone="violet">Edited</Badge>}
                    {card.pinned && <Badge tone="brand">Pinned</Badge>}
                  </div>
                  <div className="mt-2 flex gap-1 border-t border-slate-100 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(card.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={card.pinned}
                      onClick={() => update(card.id, { pinned: !card.pinned })}
                    >
                      {card.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-red-700"
                      onClick={() => remove(card.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
