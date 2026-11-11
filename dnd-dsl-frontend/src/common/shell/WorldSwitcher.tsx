import { useContext, useEffect, useRef, useState } from 'react';
import { DslContext } from '../../contexts/DslContext';
import { call, errorText, panel, row, type Adventure } from './file-ui';

/** The open world's name in the title bar; a click lists the other worlds of the adventure and runs the one chosen. */
export default function WorldSwitcher() {
  const { adventure, world } = useContext(DslContext);
  const [open, setOpen] = useState(false);
  const [worlds, setWorlds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    call<Adventure[]>('list')
      .then(list => setWorlds(list.find(a => a.name === adventure)?.worlds ?? []))
      .catch(() => setWorlds([]));

    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, adventure]);

  const choose = (next: string) => {
    setOpen(false);
    if (next === world) return;
    call(`open?adventure=${encodeURIComponent(adventure)}&world=${encodeURIComponent(next)}`, { method: 'POST' })
      .catch(e => window.alert(errorText(e)));
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <span
        role="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change the world that is running"
        onClick={() => setOpen(previous => !previous)}
        style={{ cursor: 'pointer', padding: '2px 6px', borderRadius: 3, background: open ? 'var(--bg-hover)' : undefined }}
      >
        {world} &#9662;
      </span>
      {open && (
        <div role="menu" style={{ ...panel, position: 'absolute', top: '100%', left: 0, zIndex: 3000, minWidth: 180, padding: '4px 0', marginTop: 2 }}>
          {worlds.map(name => (
            <button
              key={name}
              role="menuitem"
              style={{ ...row, padding: '5px 14px', background: name === world ? 'var(--bg-selection)' : 'transparent' }}
              onClick={() => choose(name)}
            >
              <span>{name}</span>
              {name === world && <span style={{ color: 'var(--fg-secondary)' }}>running</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
