import React, { useContext, useEffect, useRef, useState } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';
import { FileContext } from '../contexts/FileContext';
import { DslContext } from '../contexts/DslContext';
import { BackendURL } from '../contexts/BackendContext';

const MERGED_REFRESH_DELAY_MS = 150;

export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);
  const fileContext = useContext(FileContext);
  const dslContext = useContext(DslContext);
  // Swaps the editor to a read-only model of the world with its runtime state merged in
  // (GET /world/render). The source model stays alive, so toggling back keeps its cursor,
  // undo stack and unsaved edits; each mode remembers its own scroll position.
  // The merged text is prefetched after every state change, so switching is instant.
  const [showMerged, setShowMerged] = useState(false);
  const [mergedError, setMergedError] = useState<string | null>(null);
  const mergedCache = useRef<string | null>(null);
  const showMergedRef = useRef(showMerged);
  showMergedRef.current = showMerged;
  // Ctrl+S writes the file and reparses it - the toast is the only signal that the
  // reparse actually landed (a parse error leaves the file saved but the served
  // worldState on the last-good version, which is otherwise silent).
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; errors?: string[] } | null>(null);

  useEffect(() => {
    if (!saveStatus) return;
    const timer = setTimeout(() => setSaveStatus(null), saveStatus.ok ? 2000 : 5000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const loadMerged = (isCancelled: () => boolean) =>
    fetch(`${BackendURL}/world/render`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(text => {
        if (isCancelled()) return;
        mergedCache.current = text;
        setMergedError(null);
        if (showMergedRef.current) void monacoContext.showMergedView(text);
      })
      .catch(e => { if (!isCancelled()) setMergedError(String(e.message ?? e)); });

  // Debounced so a script or a time advance that changes the state in bursts costs one request.
  useEffect(() => {
    if (!dslContext.worldState) return;
    let cancelled = false;
    const timer = setTimeout(() => void loadMerged(() => cancelled), MERGED_REFRESH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dslContext.worldState]);

  useEffect(() => {
    if (!showMerged) {
      monacoContext.showSourceView();
      return;
    }
    if (mergedCache.current !== null) {
      void monacoContext.showMergedView(mergedCache.current);
      return;
    }
    // Nothing cached yet (first load, or the last fetch failed): fetch now.
    let cancelled = false;
    void loadMerged(() => cancelled);
    return () => { cancelled = true; };
  }, [showMerged]);

  useEffect(() => {
    if(!fileContext.loaded)
      return

    if (containerRef.current) {
        monacoContext.startEditor(containerRef.current);
    }
    console.log('Editor handleKeyDown registered');
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            e.stopPropagation();
            console.log('Ctrl+S pressed, saving file...');
            monacoContext.saveFile().then(setSaveStatus);
        }
    };
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        monacoContext.disposeEditor();
    };
  }, [fileContext.loaded]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef} className='h-full w-full' />
      {showMerged && mergedError && (
        <div style={{
          position: 'absolute', top: 40, right: 24, zIndex: 10, maxWidth: 320,
          background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderLeft: '3px solid var(--error)',
          borderRadius: 4, padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: 12,
          color: 'var(--fg-primary)',
        }}>
          Could not load the merged source: {mergedError}
        </div>
      )}
      <label style={{
        position: 'absolute', top: 8, right: 24, zIndex: 10, display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderRadius: 4,
        padding: '4px 10px', fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--fg-primary)',
        cursor: 'pointer', userSelect: 'none',
      }}>
        <input type='checkbox' checked={showMerged} onChange={e => setShowMerged(e.target.checked)} />
        Show with state
      </label>
      {saveStatus && (
        <div style={{
          position: 'fixed', bottom: 12, left: 12, zIndex: 1000,
          background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)',
          borderLeft: `3px solid ${saveStatus.ok ? 'var(--accent)' : 'var(--error)'}`,
          borderRadius: 4, padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: 12,
          color: 'var(--fg-primary)', maxWidth: 320,
        }}>
          {saveStatus.ok ? 'Saved' : `Save failed: ${saveStatus.errors?.join(', ') ?? 'parse error'}`}
        </div>
      )}
    </div>
  );
};