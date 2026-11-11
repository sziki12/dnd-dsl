import { useContext, useEffect, useState, type CSSProperties } from 'react';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { DslContext } from '../../contexts/DslContext';
import { MonacoContext } from '../../contexts/MonacoContext';
import { call, errorText } from './file-ui';

type OutlineNode = { name: string; file: string; line: number; children: OutlineNode[] };
type OutlineWorld = { world: string; locations: OutlineNode[]; problem?: string };

/** The locations of the worlds that are not open, with the file and line of each. Refreshed when files change. */
function useOutline(adventure: string, activeWorld: string, version: number): Map<string, OutlineWorld> {
  const [outline, setOutline] = useState<Map<string, OutlineWorld>>(new Map());
  useEffect(() => {
    if (!adventure) return;
    let cancelled = false;
    call<{ worlds: OutlineWorld[] }>(`outline?adventure=${encodeURIComponent(adventure)}&skip=${encodeURIComponent(activeWorld)}`)
      .then(result => { if (!cancelled) setOutline(new Map(result.worlds.map(w => [w.world, w]))); })
      .catch(() => { if (!cancelled) setOutline(new Map()); });
    return () => { cancelled = true; };
  }, [adventure, activeWorld, version]);
  return outline;
}

const row = (indent: number, extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 4, width: '100%', height: 24, padding: `3px 8px 3px ${8 + indent * 14}px`,
  border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', fontSize: 12, fontFamily: 'inherit',
  cursor: 'pointer', ...extra,
});

const muted: CSSProperties = { color: 'var(--fg-muted)', fontSize: 11.5 };

function Chevron({ open, visible = true }: { open: boolean; visible?: boolean }) {
  return (
    <span style={{ width: 14, display: 'inline-flex', opacity: visible ? 0.8 : 0 }}>
      {open ? <ExpandMoreIcon style={{ fontSize: 14 }} /> : <ChevronRightIcon style={{ fontSize: 14 }} />}
    </span>
  );
}

function Locations({ world, nodes, depth, open, toggle, onReveal }: {
  world: string; nodes: OutlineNode[]; depth: number; open: Set<string>; toggle: (key: string) => void;
  onReveal: (world: string, file: string, line: number) => void;
}) {
  return (
    <>
      {nodes.map(node => {
        const key = `${world}\u0000${depth}\u0000${node.file}\u0000${node.line}`;
        const isOpen = open.has(key);
        return (
          <div key={key}>
            <div style={row(depth, { cursor: 'default', padding: `0 8px 0 ${8 + depth * 14}px`, height: 22 })}>
              <button
                type="button"
                aria-label={node.children.length ? (isOpen ? 'Hide the sublocations' : 'Show the sublocations') : undefined}
                onClick={() => node.children.length && toggle(key)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: node.children.length ? 'pointer' : 'default', display: 'inline-flex' }}
              >
                <Chevron open={isOpen} visible={node.children.length > 0} />
              </button>
              <button
                type="button"
                title={`${node.file}, line ${node.line}`}
                onClick={() => onReveal(world, node.file, node.line)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {node.name}
              </button>
            </div>
            {isOpen && node.children.length > 0 && (
              <Locations world={world} nodes={node.children} depth={depth + 1} open={open} toggle={toggle} onReveal={onReveal} />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * The open adventure in the Editor: its worlds as collapsible items, each holding its files (with a dot on the ones
 * with unsaved edits and a button to add one), and, for the worlds that are not open, their locations nested as
 * written. A click on a location shows where it is declared.
 */
export default function AdventureTree() {
  const { adventure, filesVersion, world: activeWorld } = useContext(DslContext);
  const { worlds, files, selected, selectFile: onSelect, createFile: onCreate, revealAt: onReveal, merged: disabled } = useContext(MonacoContext);
  const onMakeActive = (world: string) => {
    call(`open?adventure=${encodeURIComponent(adventure)}&world=${encodeURIComponent(world)}`, { method: 'POST' })
      .catch(e => window.alert(errorText(e)));
  };
  const outline = useOutline(adventure, activeWorld, filesVersion);
  const [open, setOpen] = useState<Set<string>>(() => new Set([activeWorld]));
  const [openLocations, setOpenLocations] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The world that becomes the open one is shown.
  useEffect(() => {
    setOpen(previous => previous.has(activeWorld) ? previous : new Set(previous).add(activeWorld));
  }, [activeWorld]);

  const flip = (setter: typeof setOpen) => (key: string) =>
    setter(previous => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toggleWorld = flip(setOpen);
  const toggleLocation = flip(setOpenLocations);

  const create = async (event: React.FormEvent, world: string) => {
    event.preventDefault();
    if (!name.trim()) return;
    const result = await onCreate(world, name.trim());
    if (result.ok) {
      setAdding(null);
      setName('');
      setError(null);
    } else {
      setError(result.error ?? 'Could not add the file.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontSize: 12 }}>
      <div style={{ padding: '8px 12px 6px', fontSize: 11, textTransform: 'uppercase', color: 'var(--fg-secondary)', letterSpacing: '.04em' }}>
        {adventure}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {worlds.map(({ world, problem }) => {
          const isActive = world === activeWorld;
          const isOpen = open.has(world);
          const own = files.filter(file => file.world === world);
          const places = outline.get(world);
          const locationsKey = `${world}\u0000locations`;
          return (
            <div key={world}>
              <div style={row(0, { cursor: 'default', background: isActive ? 'var(--accent-soft)' : 'transparent', color: isActive ? 'var(--fg-bright)' : 'inherit' })}>
                <button
                  type="button"
                  onClick={() => toggleWorld(world)}
                  aria-expanded={isOpen}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textAlign: 'left' }}
                >
                  <Chevron open={isOpen} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{world}</span>
                </button>
                {isActive
                  ? <span title="The world that is running" style={{ ...muted, color: 'var(--fg-bright)' }}>active</span>
                  : (
                    <button
                      type="button"
                      title="Run this world"
                      onClick={() => onMakeActive(world)}
                      style={{ background: 'transparent', border: '1px solid var(--bd-strong)', borderRadius: 3, color: 'inherit', cursor: 'pointer', fontSize: 11, padding: '0 6px', fontFamily: 'inherit' }}
                    >
                      Make active
                    </button>
                  )}
              </div>

              {isOpen && (
                <div style={{ opacity: disabled ? 0.55 : 1 }}>
                  {problem && <div style={{ ...muted, padding: '2px 12px 2px 36px', whiteSpace: 'pre-wrap' }}>{problem}</div>}
                  {own.map(file => {
                    const isSelected = selected?.world === file.world && selected.name === file.name;
                    return (
                      <button
                        key={file.name}
                        type="button"
                        disabled={disabled}
                        title={file.name}
                        onClick={() => onSelect(file.world, file.name)}
                        style={row(2, {
                          justifyContent: 'space-between', cursor: disabled ? 'default' : 'pointer',
                          background: isSelected ? 'var(--accent-soft)' : 'transparent', color: isSelected ? 'var(--fg-bright)' : 'inherit',
                        })}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                        {file.dirty && <span aria-label="unsaved changes" title="Unsaved changes" style={{ color: 'var(--fg-bright)' }}>&bull;</span>}
                      </button>
                    );
                  })}
                  {adding === world ? (
                    <form onSubmit={event => create(event, world)} style={{ padding: '2px 8px 4px 36px' }}>
                      <input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') { setAdding(null); setError(null); } }}
                        placeholder="File name"
                        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--bd-soft)', borderRadius: 3, color: 'var(--fg-primary)', padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }}
                      />
                      {error && <div style={{ color: 'var(--error)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{error}</div>}
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => { setAdding(world); setName(''); setError(null); }}
                      style={row(2, { ...muted, cursor: disabled ? 'default' : 'pointer' })}
                    >
                      + New file
                    </button>
                  )}

                  {!isActive && places && (
                    places.problem
                      ? <div style={{ ...muted, padding: '2px 12px 2px 36px', whiteSpace: 'pre-wrap' }}>Locations unavailable: {places.problem}</div>
                      : places.locations.length > 0 && (
                        <>
                          <button type="button" onClick={() => toggleLocation(locationsKey)} aria-expanded={openLocations.has(locationsKey)} style={row(1, { ...muted })}>
                            <Chevron open={openLocations.has(locationsKey)} />
                            Locations ({places.locations.length})
                          </button>
                          {openLocations.has(locationsKey) && (
                            <Locations world={world} nodes={places.locations} depth={3} open={openLocations} toggle={toggleLocation} onReveal={onReveal} />
                          )}
                        </>
                      )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
