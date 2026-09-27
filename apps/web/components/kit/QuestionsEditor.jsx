'use client';

// The question bank, grouped by category. Questions can be dragged to
// reorder or to move to another category (mouse, touch or keyboard: focus the
// handle, Space to lift, arrows to move, Space to drop), or moved with the
// explicit buttons and menu, which also work where dragging is awkward.
// Every change applies to the local draft at once and saves in the background.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { CATEGORIES, CATEGORY_HINTS, CATEGORY_LABELS } from '@/lib/format';
import { tempId } from '@/lib/kit-sync';
import { Button, useToast } from '../ui';
import { QuestionCard } from './QuestionCard';

/** Keeps the list grouped in category order (the order the page shows). */
export function groupByCategory(questions) {
  return CATEGORIES.flatMap((c) => questions.filter((q) => q.category === c));
}

export function QuestionsEditor({ editor }) {
  const { draft, edit, regenerate, busy, record } = editor;
  const requirements = record.kit.role.requirements;
  const toast = useToast();
  const [editingId, setEditingId] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setQuestions = (fn) => edit((d) => ({ ...d, questions: groupByCategory(fn(d.questions)) }));

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setQuestions((list) => {
      const moving = list.find((q) => q.id === active.id);
      if (!moving) return list;
      const overIsContainer = String(over.id).startsWith('category:');
      const target = overIsContainer
        ? String(over.id).slice(9)
        : list.find((q) => q.id === over.id)?.category;
      if (!target) return list;

      if (target === moving.category && !overIsContainer) {
        const inCategory = list.filter((q) => q.category === target);
        const reordered = arrayMove(
          inCategory,
          inCategory.findIndex((q) => q.id === active.id),
          inCategory.findIndex((q) => q.id === over.id),
        );
        return CATEGORIES.flatMap((c) => (c === target ? reordered : list.filter((q) => q.category === c)));
      }
      const without = list.filter((q) => q.id !== active.id);
      const targetItems = without.filter((q) => q.category === target);
      const at = overIsContainer ? targetItems.length : targetItems.findIndex((q) => q.id === over.id);
      targetItems.splice(at < 0 ? targetItems.length : at, 0, { ...moving, category: target });
      return CATEGORIES.flatMap((c) =>
        c === target ? targetItems : without.filter((q) => q.category === c),
      );
    });
  }

  const update = (id, changes) =>
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, ...changes } : q)));

  function move(id, delta) {
    setQuestions((list) => {
      const q = list.find((x) => x.id === id);
      const inCategory = list.filter((x) => x.category === q.category);
      const from = inCategory.indexOf(q);
      const to = from + delta;
      if (to < 0 || to >= inCategory.length) return list;
      const reordered = arrayMove(inCategory, from, to);
      return CATEGORIES.flatMap((c) => (c === q.category ? reordered : list.filter((x) => x.category === c)));
    });
  }

  function moveToCategory(id, category) {
    setQuestions((list) => {
      const q = list.find((x) => x.id === id);
      return [...list.filter((x) => x.id !== id), { ...q, category }];
    });
    toast({ message: `Moved to ${CATEGORY_LABELS[category]}.` });
  }

  function remove(id) {
    const index = draft.questions.findIndex((q) => q.id === id);
    const removed = draft.questions[index];
    setQuestions((list) => list.filter((q) => q.id !== id));
    toast({
      message: 'Question deleted.',
      action: {
        label: 'Undo',
        onClick: () =>
          setQuestions((list) =>
            list.some((q) => q.id === removed.id)
              ? list
              : [...list.slice(0, index), removed, ...list.slice(index)],
          ),
      },
    });
  }

  function add(category) {
    const question = {
      id: tempId('q'),
      category,
      prompt: '',
      answer_outline: '',
      difficulty: 2,
      requirement_ids: [],
      pinned: false,
      origin: 'user',
      edited: false,
    };
    setQuestions((list) => [...list, question]);
    setEditingId(question.id);
  }

  async function onRegenerate(category) {
    const inCategory = draft.questions.filter((q) => q.category === category);
    const replaceable = inCategory.filter((q) => q.origin !== 'user' && !q.edited && !q.pinned).length;
    const kept = inCategory.length - replaceable;
    const message =
      `Regenerate ${CATEGORY_LABELS[category]} questions?\n\n` +
      `${replaceable} AI-written question(s) you have not touched will be replaced.` +
      (kept ? `\n${kept} question(s) you wrote, edited or pinned will be kept.` : '');
    if (!window.confirm(message)) return;
    const result = await regenerate({ section: 'questions', category });
    toast(
      result.ok
        ? { message: `${CATEGORY_LABELS[category]} questions regenerated. Your edits were kept.` }
        : { message: result.error.message, tone: 'error' },
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <p className="mb-4 text-sm text-slate-600">
        Edit anything inline. Drag the handle (or focus it and press Space, then the arrow keys) to reorder or
        move a question to another category. Pinned, edited and hand-written questions survive regeneration.
      </p>
      <div className="space-y-6">
        {CATEGORIES.map((category) => {
          const items = draft.questions.filter((q) => q.category === category);
          return (
            <CategorySection
              key={category}
              category={category}
              count={items.length}
              busy={busy[`questions:${category}`]}
              onAdd={() => add(category)}
              onRegenerate={() => onRegenerate(category)}
            >
              <SortableContext items={items.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {items.map((q, i) => (
                    <SortableItem key={q.id} id={q.id}>
                      {(handle) => (
                        <QuestionCard
                          question={q}
                          requirements={requirements}
                          handle={handle}
                          editing={editingId === q.id}
                          onEditingChange={(on) => setEditingId(on ? q.id : null)}
                          onChange={(changes) => update(q.id, changes)}
                          onDelete={() => remove(q.id)}
                          onMoveUp={i > 0 ? () => move(q.id, -1) : null}
                          onMoveDown={i < items.length - 1 ? () => move(q.id, 1) : null}
                          onMoveToCategory={(c) => moveToCategory(q.id, c)}
                        />
                      )}
                    </SortableItem>
                  ))}
                </ul>
              </SortableContext>
            </CategorySection>
          );
        })}
      </div>
    </DndContext>
  );
}

function CategorySection({ category, count, busy, onAdd, onRegenerate, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `category:${category}` });
  return (
    <section aria-labelledby={`cat-${category}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`cat-${category}`} className="font-semibold">
            {CATEGORY_LABELS[category]} <span className="text-sm font-normal text-slate-500">({count})</span>
          </h2>
          <p className="text-xs text-slate-500">{CATEGORY_HINTS[category]}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onAdd}>
            + Add question
          </Button>
          <Button variant="secondary" size="sm" busy={busy} onClick={onRegenerate}>
            Regenerate
          </Button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`mt-2 rounded-xl p-1 transition-colors ${isOver ? 'bg-brand-50 ring-2 ring-brand-200' : ''} ${busy ? 'opacity-60' : ''}`}
        aria-busy={busy || undefined}
      >
        {children}
        {count === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            No {CATEGORY_LABELS[category].toLowerCase()} questions. Add one, drop one here, or regenerate.
          </p>
        )}
      </div>
    </section>
  );
}

function SortableItem({ id, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80 shadow-lg' : ''}
    >
      {children({ ref: setActivatorNodeRef, ...attributes, ...listeners })}
    </li>
  );
}
