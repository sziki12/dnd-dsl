import React, { useContext, useEffect, useRef, useState } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';
import { FileContext } from '../contexts/FileContext';

export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);
  const fileContext = useContext(FileContext);
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