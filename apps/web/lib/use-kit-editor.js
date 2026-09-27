'use client';

// The builder's state. Edits change a local draft at once (no waiting on the
// network per keystroke) and are saved in the background, debounced. Saves
// are serialised; a version conflict (another tab, or a regeneration that
// landed first) is resolved by rebasing the user's unsaved changes onto the
// server's newer kit and saving again. See lib/kit-sync.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { adoptServerIds, isDirty, rebase, sectionsOf, toPatch } from './kit-sync';

const SAVE_DELAY_MS = 700;

/** Problems that would make the server reject a save; shown instead of saving. */
export function draftProblems(draft) {
  const problems = [];
  if (draft.questions.some((q) => !q.prompt.trim())) problems.push('A question is empty.');
  if (draft.flashcards.some((f) => !f.front.trim() || !f.back.trim())) {
    problems.push('A flashcard is missing its front or back.');
  }
  if (draft.stories.some((st) => !st.title.trim())) problems.push('A story needs a title.');
  return problems;
}

export function useKitEditor(initialRecord) {
  const id = initialRecord.id;
  const [record, setRecord] = useState(initialRecord);
  const [draft, setDraftState] = useState(() => sectionsOf(initialRecord.kit));
  // saved | pending | saving | invalid | error
  const [status, setStatus] = useState({ state: 'saved' });
  const [busy, setBusy] = useState({}); // regenerations in progress, by key

  const draftRef = useRef(draft);
  const baseRef = useRef(sectionsOf(initialRecord.kit));
  const versionRef = useRef(initialRecord.version);
  const timerRef = useRef(null);
  const chainRef = useRef(Promise.resolve());

  const setDraft = useCallback((next) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const saveNow = useCallback(async () => {
    let conflicts = 0;
    for (;;) {
      const sent = draftRef.current;
      if (!isDirty(sent, baseRef.current)) {
        setStatus({ state: 'saved' });
        return;
      }
      const problems = draftProblems(sent);
      if (problems.length) {
        setStatus({ state: 'invalid', message: problems[0] });
        return;
      }
      setStatus({ state: 'saving' });
      try {
        const { kit: saved } = await api(`/kits/${id}`, {
          method: 'PATCH',
          body: toPatch(sent, versionRef.current),
        });
        const server = sectionsOf(saved.kit);
        // Replay anything typed while the save was in flight.
        const sentWithIds = adoptServerIds(sent, sent, server);
        const latest = adoptServerIds(draftRef.current, sent, server);
        baseRef.current = server;
        versionRef.current = saved.version;
        setRecord(saved);
        setDraft(rebase(server, latest, sentWithIds));
      } catch (err) {
        if (err.code === 'VERSION_CONFLICT' && err.details?.kit && conflicts++ < 3) {
          const server = sectionsOf(err.details.kit);
          setDraft(rebase(server, draftRef.current, baseRef.current));
          baseRef.current = server;
          versionRef.current = err.details.version;
          setRecord((r) => ({ ...r, kit: err.details.kit, version: err.details.version }));
          continue;
        }
        setStatus({ state: 'error', message: err.message });
        return;
      }
    }
  }, [id, setDraft]);

  // Saves run one after another, never in parallel.
  const save = useCallback(() => {
    chainRef.current = chainRef.current.then(saveNow, saveNow);
    return chainRef.current;
  }, [saveNow]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    return save();
  }, [save]);

  /** Applies a change to the draft: `fn(draft) => newDraft`. */
  const edit = useCallback(
    (fn) => {
      setDraft(fn(draftRef.current));
      setStatus({ state: 'pending' });
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, SAVE_DELAY_MS);
    },
    [save, setDraft],
  );

  /** Takes a newer record from the server (e.g. after regeneration), keeping unsaved edits. */
  const adopt = useCallback(
    (fresh) => {
      const server = sectionsOf(fresh.kit);
      const next = rebase(server, draftRef.current, baseRef.current);
      baseRef.current = server;
      versionRef.current = fresh.version;
      setRecord(fresh);
      setDraft(next);
      if (isDirty(next, server)) {
        setStatus({ state: 'pending' });
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(save, SAVE_DELAY_MS);
      }
    },
    [save, setDraft],
  );

  /**
   * Regenerates a section. Pending edits are saved first, so the server
   * knows about them; edits made while the model works are merged in after.
   */
  const regenerate = useCallback(
    async (body) => {
      const key = body.section === 'questions' ? `questions:${body.category}` : body.section;
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        await flush();
        const { kit: fresh } = await api(`/kits/${id}/regenerate`, { method: 'POST', body });
        adopt(fresh);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [id, flush, adopt],
  );

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (isDirty(draftRef.current, baseRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(timerRef.current);
    };
  }, []);

  return { record, draft, status, busy, edit, flush, regenerate, retrySave: save };
}
