import { useContext, useEffect, useState, type FormEvent } from 'react';
import { DslContext } from '../../contexts/DslContext';
import { button, call, ErrorLine, errorText, field, Hint, primary, row, type Adventure } from './file-ui';

type PickerProps = { onDone: () => void; confirmDiscard: () => boolean };

/** Every world of every adventure in the source folder; a click opens one. Used in a dialog and on the first-run screen. */
export function WorldList({ onDone, confirmDiscard }: PickerProps) {
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
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div>
      {adventures?.length === 0 && <Hint>The source folder has no adventures yet. Make one with New.</Hint>}
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
    </div>
  );
}

/** The adventure and world to create, or to copy the open world to. */
export function WorldForm({ mode, onDone, onCancel, confirmDiscard }: PickerProps & { mode: 'new' | 'saveAs'; onCancel?: () => void }) {
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
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <form onSubmit={submit}>
      <Hint>
        {mode === 'new'
          ? 'Creates an empty world and opens it. A new adventure name makes a new adventure.'
          : 'Copies the open world with its state, layout, map settings and saved states, and opens the copy. A new adventure also gets the map images.'}
      </Hint>
      <label>Adventure
        <input style={{ ...field, marginBottom: 8 }} list="file-menu-adventures" value={adventureName} onChange={e => setAdventureName(e.target.value)} />
      </label>
      <datalist id="file-menu-adventures">{adventures.map(a => <option key={a.name} value={a.name} />)}</datalist>
      <label>World
        <input style={field} value={worldName} onChange={e => setWorldName(e.target.value)} />
      </label>
      <ErrorLine text={error} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {onCancel && <button type="button" style={button} onClick={onCancel}>Cancel</button>}
        <button type="submit" style={primary}>{mode === 'new' ? 'Create' : 'Save as'}</button>
      </div>
    </form>
  );
}
