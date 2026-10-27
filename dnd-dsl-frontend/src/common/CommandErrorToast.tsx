import { useContext, useEffect } from 'react';
import { DslContext } from '../contexts/DslContext';

const VISIBLE_MS = 8000;

/** Why the last command was rejected. The world state on screen is the last good one. */
export default function CommandErrorToast() {
  const { commandError, clearCommandError } = useContext(DslContext);

  useEffect(() => {
    if (!commandError) return;
    const timer = setTimeout(clearCommandError, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [commandError, clearCommandError]);

  if (!commandError) return null;

  return (
    <div role="alert" style={{
      position: 'fixed', bottom: 'calc(var(--status-h) + 12px)', left: 12, zIndex: 1000, width: 320,
      background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderLeft: '3px solid var(--error)',
      borderRadius: 4, padding: '8px 10px', fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--fg-primary)',
    }}>
      <div style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>{commandError}</div>
      <button
        style={{
          background: 'transparent', border: '1px solid var(--bd-soft)', borderRadius: 3,
          color: 'inherit', cursor: 'pointer', padding: '2px 8px', fontSize: 11,
        }}
        onClick={clearCommandError}
      >
        Dismiss
      </button>
    </div>
  );
}
