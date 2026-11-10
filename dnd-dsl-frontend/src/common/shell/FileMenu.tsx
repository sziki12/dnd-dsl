import { useContext, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { BackendURL } from '../../contexts/BackendContext';
import { DslContext } from '../../contexts/DslContext';
import { MonacoContext } from '../../contexts/MonacoContext';

type Adventure = { name: string; worlds: string[] };
type NamedState = { name: string; savedAt: string };
type Action = 'open' | 'new' | 'saveAs' | 'saveState' | 'loadState';

const MENU: ({ action: Action; label: string } | 'separator')[] = [
  { action: 'open', label: 'Open adventure or world...' },
  { action: 'new', label: 'New adventure or world...' },
  { action: 'saveAs', label: 'Save world as...' },
  'separator',
  { action: 'saveState', label: 'Save state as...' },
  { action: 'loadState', label: 'Load state...' },
];

async function call<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BackendURL}/adventure/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `Request failed (${response.status})`);
  return body as T;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const panel: CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--bd-strong)', borderRadius: 4,
  boxShadow: '0 6px 24px rgba(0,0,0,0.5)', color: 'var(--fg-primary)', fontFamily: 'var(--font-ui)', fontSize: 12,
};
const field: CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--bd-soft)', borderRadius: 3, color: 'var(--fg-primary)',
  padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const button: CSSProperties = {
  background: 'transparent', border: '1px solid var(--bd-strong)', borderRadius: 3, color: 'inherit',
  cursor: 'pointer', padding: '4px 12px', fontSize: 12, fontFamily: 'inherit',
};
const primary: CSSProperties = { ...button, background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--fg-bright)' };
const row: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', padding: '4px 8px', cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'inherit', fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
};

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 80 }}
    >
      <div role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()} style={{ ...panel, width: 420, padding: 16 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg-bright)', marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

const ErrorLine = ({ text }: { text: string | null }) =>
  text ? <div style={{ color: 'var(--error)', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{text}</div> : null;

const Hint = ({ children }: { children: ReactNode }) => <div style={{ color: 'var(--fg-secondary)', marginBottom: 10 }}>{children}</div>;

type DialogProps = { onClose: () => void; confirmDiscard: () => boolean };

function OpenDialog({ onClose, confirmDiscard }: DialogProps) {
  const { adventure, world } = useContext(DslContext);
  const [adventures, setAdventures] = useState<Adventure[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Adventure[]>('list').then(setAdventures).catch(e => setError(errorText(e)));
  }, []);

  const open = async (nextAdventure: string, nextWorld: string) => {
    if ((nextAdventure === adventure && nextWorld === world) || !confirmDiscard()) return;
    try {
      await call(`open?adventure=${encodeURIComponent(nextAdventure)}&world=${encodeURIComponent(nextWorld)}`, { method: 'POST' });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog title="Open adventure or world" onClose={onClose}>
      {adventures?.length === 0 && <Hint>The save folder has no adventures yet. Use New to make one.</Hint>}
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {adventures?.map(a => (
          <div key={a.name} style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--fg-secondary)', padding: '2px 8px' }}>{a.name}</div>
            {a.worlds.length === 0 && <div style={{ color: 'var(--fg-muted)', padding: '2px 20px' }}>no worlds</div>}
            {a.worlds.map(w => {
              const isOpen = a.name === adventure && w === world;
              return (
                <button key={w} style={{ ...row, paddingLeft: 20, background: isOpen ? 'var(--bg-selection)' : 'transparent' }} onClick={() => open(a.name, w)}>
                  <span>{w}</span>
                  {isOpen && <span style={{ color: 'var(--fg-secondary)' }}>open</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ErrorLine text={error} />
      <div style={{ textAlign: 'right', marginTop: 8 }}><button style={button} onClick={onClose}>Close</button></div>
    </Dialog>
  );
}

function WorldForm({ mode, onClose, confirmDiscard }: DialogProps & { mode: 'new' | 'saveAs' }) {
  const { adventure } = useContext(DslContext);
  const [adventureName, setAdventureName] = useState(adventure);
  const [worldName, setWorldName] = useState('');
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Adventure[]>('list').then(setAdventures).catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = { adventure: adventureName.trim(), world: worldName.trim() };
    if (!target.adventure || !target.world || !confirmDiscard()) return;
    try {
      await call(mode === 'new' ? 'new' : 'save-as', { method: 'POST', body: target });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog title={mode === 'new' ? 'New adventure or world' : 'Save world as'} onClose={onClose}>
      <form onSubmit={submit}>
        <Hint>
          {mode === 'new'
            ? 'Creates an empty world and opens it. A new adventure name makes a new adventure.'
            : 'Copies the open world with its state, layout, map settings and saved states, and opens the copy. A new adventure also gets the map images.'}
        </Hint>
        <label>Adventure
          <input style={{ ...field, marginBottom: 8 }} list="file-menu-adventures" value={adventureName} onChange={e => setAdventureName(e.target.value)} autoFocus />
        </label>
        <datalist id="file-menu-adventures">{adventures.map(a => <option key={a.name} value={a.name} />)}</datalist>
        <label>World
          <input style={field} value={worldName} onChange={e => setWorldName(e.target.value)} />
        </label>
        <ErrorLine text={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" style={button} onClick={onClose}>Cancel</button>
          <button type="submit" style={primary}>{mode === 'new' ? 'Create' : 'Save as'}</button>
        </div>
      </form>
    </Dialog>
  );
}

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
  const { adventure, world } = useContext(DslContext);

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
  const disabled = !adventure || !world;

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
          <div role="menu" style={{ ...panel, position: 'absolute', top: '100%', left: 0, zIndex: 3000, minWidth: 220, padding: '4px 0', marginTop: 2 }}>
            {MENU.map((item, i) => item === 'separator'
              ? <div key={i} style={{ borderTop: '1px solid var(--bd-soft)', margin: '4px 0' }} />
              : (
                <button key={item.action} role="menuitem" disabled={disabled} style={{ ...row, padding: '5px 14px', opacity: disabled ? 0.5 : 1 }} onClick={() => choose(item.action)}>
                  {item.label}
                </button>
              ))}
            <div style={{ borderTop: '1px solid var(--bd-soft)', margin: '4px 0' }} />
            <button role="menuitem" style={{ ...row, padding: '5px 14px' }} onClick={reveal}>Show save folder in file explorer</button>
          </div>
        )}
      </div>
      {action === 'open' && <OpenDialog onClose={close} confirmDiscard={confirmDiscard} />}
      {(action === 'new' || action === 'saveAs') && <WorldForm mode={action} onClose={close} confirmDiscard={confirmDiscard} />}
      {action === 'saveState' && <SaveStateDialog onClose={close} confirmDiscard={confirmDiscard} />}
      {action === 'loadState' && <LoadStateDialog onClose={close} confirmDiscard={confirmDiscard} />}
    </>
  );
}
