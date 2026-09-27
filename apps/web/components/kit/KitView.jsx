'use client';

// The ready kit: a header with save status, and tabs for the overview, the
// questions, the flashcards and the schedule. All editing goes through
// useKitEditor, which owns the draft and background saving.

import { useRef, useState } from 'react';
import { useKitEditor } from '@/lib/use-kit-editor';
import { ButtonLink } from '../ui';
import { FlashcardsEditor } from './FlashcardsEditor';
import { Overview } from './Overview';
import { QuestionsEditor } from './QuestionsEditor';
import { SaveStatus } from './SaveStatus';
import { ScheduleView } from './ScheduleView';

const TABS = [
  ['overview', 'Overview'],
  ['questions', 'Questions'],
  ['flashcards', 'Flashcards'],
  ['schedule', 'Schedule'],
];

export function KitView({ initialRecord }) {
  const editor = useKitEditor(initialRecord);
  const { record, draft } = editor;
  const kit = record.kit;
  const [tab, setTab] = useState('overview');
  const tabRefs = useRef({});

  // Arrow keys move between tabs, as screen-reader users expect.
  function onTabKey(event) {
    const index = TABS.findIndex(([key]) => key === tab);
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!delta) return;
    const [next] = TABS[(index + delta + TABS.length) % TABS.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{kit.role.title}</h1>
          <p className="text-sm text-slate-600">
            {kit.source.company}
            {kit.source.location !== 'Not stated' && ` · ${kit.source.location}`} ·{' '}
            {kit.schedule.days_available} day{kit.schedule.days_available === 1 ? '' : 's'} to prepare
          </p>
        </div>
        <div className="no-print flex items-center gap-3">
          <SaveStatus status={editor.status} onRetry={editor.retrySave} />
          <ButtonLink href={`/kits/${record.id}/practice`}>Practise</ButtonLink>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Kit sections"
        className="no-print mt-5 flex gap-1 overflow-x-auto border-b border-slate-200"
        onKeyDown={onTabKey}
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            id={`tab-${key}`}
            role="tab"
            type="button"
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 aria-selected:border-brand-600 aria-selected:text-brand-700"
          >
            {label}
            {key === 'questions' && (
              <span className="ml-1 text-xs text-slate-400">{draft.questions.length}</span>
            )}
            {key === 'flashcards' && (
              <span className="ml-1 text-xs text-slate-400">{draft.flashcards.length}</span>
            )}
          </button>
        ))}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === 'overview' && <Overview editor={editor} />}
        {tab === 'questions' && <QuestionsEditor editor={editor} />}
        {tab === 'flashcards' && <FlashcardsEditor editor={editor} />}
        {tab === 'schedule' && <ScheduleView editor={editor} />}
      </div>
    </div>
  );
}
