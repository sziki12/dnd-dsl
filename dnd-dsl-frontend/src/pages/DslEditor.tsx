import React, { useContext, useEffect, useRef, useState } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';
import { FileContext } from '../contexts/FileContext';
import { DslContext } from '../contexts/DslContext';
import { BackendURL } from '../contexts/BackendContext';

export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);
  const fileContext = useContext(FileContext);
  const dslContext = useContext(DslContext);
  // Shows the loaded world's source with the runtime state merged in (GET /world/render).
  // The editor stays mounted underneath so toggling back keeps cursor, undo stack and unsaved edits.
  const [showMerged, setShowMerged] = useState(false);
  const [mergedText, setMergedText] = useState('');
  const [mergedError, setMergedError] = useState<string | null>(null);
  // Ctrl+S writes the file and reparses it - the toast is the only signal that the
  // reparse actually landed (a parse error leaves the file saved but the served
  // worldState on the last-good version, which is otherwise silent).
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; errors?: string[] } | null>(null);

  useEffect(() => {
    if (!saveStatus) return;
    const timer = setTimeout(() => setSaveStatus(null), saveStatus.ok ? 2000 : 5000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  useEffect(() => {
    if (!showMerged) return;
    let cancelled = false;
    fetch(`${BackendURL}/world/render`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(text => { if (!cancelled) { setMergedText(text); setMergedError(null); } })
      .catch(e => { if (!cancelled) setMergedError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [showMerged, dslContext.worldState]);

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
      <div ref={containerRef} className='h-full w-full' style={{ display: showMerged ? 'none' : undefined }} />
      {showMerged && (
        <pre style={{
          position: 'absolute', inset: 0, margin: 0, padding: '12px 16px', overflow: 'auto',
          background: 'var(--bg-panel)', color: 'var(--fg-primary)',
          fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5, tabSize: 4,
        }}>
          {mergedError ? `Could not load the merged source: ${mergedError}` : mergedText}
        </pre>
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