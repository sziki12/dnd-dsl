import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { DslContext } from '../../contexts/DslContext';
import { MonacoContext } from '../../contexts/MonacoContext';
import { button, call, Dialog, ErrorLine, errorText, field, Hint, panel, primary, row, type NamedState } from './file-ui';
import FolderBrowser from './FolderBrowser';
import { AdventureList, WorldForm } from './world-picker';

type Action = 'open' | 'new' | 'saveAs' | 'saveState' | 'loadState' | 'folder';
type Needs = 'folder' | 'world' | undefined;

const MENU: ({ action: Action; label: string; needs: Needs } | 'separator')[] = [
  { action: 'open', label: 'Open adventure...', needs: 'folder' },
  { action: 'new', label: 'New adventure or world...', needs: 'folder' },
  { action: 'saveAs', label: 'Save world as...', needs: 'world' },
  'separator',
  { action: 'saveState', label: 'Save state as...', needs: 'world' },
  { action: 'loadState', label: 'Load state...', needs: 'world' },
  'separator',
  { action: 'folder', label: 'Change source folder...', needs: undefined },
];

type DialogProps = { onClose: () => void; confirmDiscard: () => boolean };

function StatesList({ states, onPick }: { states: NamedState[]; onPick: (name: string) => void }) {
  return (
    <div style={{ maxHeight: 240, overflow: 'auto' }}>
      {states.map(s => (
        <button key={s.name} style={row} onClick={() => onPick(s.name)}>
          <span>{s.name}</span>
          <span style={{ color: 'var(--fg-secondary)' }}>{new Date(s.savedAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function useStates() {
  const [states, setStates] = useState<NamedState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<NamedState[]>('states').then(setStates).catch(e => setError(errorText(e)));
  }, []);
  return { states, error, setError };
}

function SaveStateDialog({ onClose }: DialogProps) {
  const { states, error, setError } = useStates();
  const [name, setName] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (states?.some(s => s.name === trimmed) && !window.confirm(`Replace the saved state "${trimmed}"?`)) return;
    try {
      await call('states/save', { method: 'POST', body: { name: trimmed } });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog title="Save state as" onClose={onClose}>
      <form onSubmit={submit}>
        <Hint>Stores the current variable values, clock and reminders under a name. The world file is not part of it.</Hint>
        <input style={field} value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoFocus />
        {states && states.length > 0 && (
          <>
            <div style={{ color: 'var(--fg-secondary)', margin: '10px 0 2px' }}>Saved states (click to reuse a name)</div>
            <StatesList states={states} onPick={setName} />
          </>
        )}
        <ErrorLine text={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" style={button} onClick={onClose}>Cancel</button>
          <button type="submit" style={primary}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function LoadStateDialog({ onClose }: DialogProps) {
  const { states, error, setError } = useStates();

  const load = async (name: string) => {
    if (!window.confirm(`Load the state "${name}"? The current state and the undo history are replaced.`)) return;
    try {
      await call('states/load', { method: 'POST', body: { name } });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog title="Load state" onClose={onClose}>
      {states?.length === 0 && <Hint>No states are saved for this world yet.</Hint>}
      {states && <StatesList states={states} onPick={load} />}
      <ErrorLine text={error} />
      <div style={{ textAlign: 'right', marginTop: 8 }}><button style={button} onClick={onClose}>Close</button></div>
    </Dialog>
  );
}

export default function FileMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { hasUnsavedChanges } = useContext(MonacoContext);
  const { adventure, world, sourceFolder } = useContext(DslContext);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Another world replaces the editor's text, so edits that were not saved would go with it.
  const confirmDiscard = () =>
    !hasUnsavedChanges?.() || window.confirm('The editor has unsaved changes. Continue and discard them?');

  const close = () => setAction(null);
  const choose = (next: Action) => { setMenuOpen(false); setAction(next); };
  const reveal = () => {
    setMenuOpen(false);
    call('reveal', { method: 'POST' }).catch(e => window.alert(errorText(e)));
  };
  const unavailable = (needs: Needs) => (needs === 'folder' ? !sourceFolder : needs === 'world' ? !(adventure && world) : false);

  return (
    <>
      <div ref={rootRef} style={{ position: 'relative' }}>
        <span
          role="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
          style={{ padding: '3px 8px', borderRadius: 3, cursor: 'pointer', background: menuOpen ? 'var(--bg-hover)' : undefined }}
        >
          File
        </span>
        {menuOpen && (
          <div role="menu" style={{ ...panel, position: 'absolute', top: '100%', left: 0, zIndex: 3000, minWidth: 240, padding: '4px 0', marginTop: 2 }}>
            {MENU.map((item, i) => item === 'separator'
              ? <div key={i} style={{ borderTop: '1px solid var(--bd-soft)', margin: '4px 0' }} />
              : (
                <button
                  key={item.action}
                  role="menuitem"
                  disabled={unavailable(item.needs)}
                  style={{ ...row, padding: '5px 14px', opacity: unavailable(item.needs) ? 0.5 : 1 }}
                  onClick={() => choose(item.action)}
                >
                  {item.label}
                </button>
              ))}
            <button role="menuitem" disabled={!sourceFolder} style={{ ...row, padding: '5px 14px', opacity: sourceFolder ? 1 : 0.5 }} onClick={reveal}>
              Show source folder in file explorer
            </button>
          </div>
        )}
      </div>
      {action === 'open' && (
        <Dialog title="Open adventure" onClose={close}>
          <AdventureList onDone={close} confirmDiscard={confirmDiscard} />
          <div style={{ textAlign: 'right', marginTop: 8 }}><button style={button} onClick={close}>Close</button></div>
        </Dialog>
      )}
      {(action === 'new' || action === 'saveAs') && (
        <Dialog title={action === 'new' ? 'New adventure or world' : 'Save world as'} onClose={close}>
          <WorldForm mode={action} onDone={close} onCancel={close} confirmDiscard={confirmDiscard} />
        </Dialog>
      )}
      {action === 'saveState' && <SaveStateDialog onClose={close} confirmDiscard={confirmDiscard} />}
      {action === 'loadState' && <LoadStateDialog onClose={close} confirmDiscard={confirmDiscard} />}
      {action === 'folder' && (
        <Dialog title="Change source folder" onClose={close} width={520}>
          <Hint>The folder that holds your adventures. Choosing another one closes the open world; no files are moved.</Hint>
          <FolderBrowser onDone={close} onCancel={close} />
        </Dialog>
      )}
    </>
  );
}
