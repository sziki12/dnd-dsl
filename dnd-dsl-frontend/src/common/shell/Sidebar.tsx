import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { DslContext } from '../../contexts/DslContext';
import { locationKey, locationRoute, type LocationIndex } from '../location-identity';
import { useLocationIndex, useLocationRoute } from '../useLocationIndex';
import type { SerializedLocation } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

/** A row is a location by the names that lead to it, so sublocations that share a name are separate rows. */
function LocationRow({
  loc, path, index, activeKey, expanded, onToggle, onSelect,
}: {
  loc: SerializedLocation;
  path: readonly string[];
  index: LocationIndex<SerializedLocation>;
  activeKey: string | undefined;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (path: readonly string[]) => void;
}) {
  const { getByReference } = useContext(DslContext);
  const depth = path.length - 1;
  const key = locationKey(path);
  const hasChildren = loc.sublocations.length > 0;
  const isOpen = expanded.has(key);
  const isActive = key === activeKey;

  return (
    <div>
      <div
        className="tree-row"
        onClick={() => {
          if (hasChildren) onToggle(key);
          onSelect(path);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: `2px 8px 2px ${8 + depth * 14}px`,
          height: 22, cursor: 'pointer',
          background: isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--fg-bright)' : 'var(--fg-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        <span style={{ width: 14, opacity: hasChildren ? 0.7 : 0, display: 'inline-flex' }}>
          {hasChildren && (isOpen ? <ExpandMoreIcon style={{ fontSize: 14 }} /> : <ChevronRightIcon style={{ fontSize: 14 }} />)}
        </span>
        <span style={{ display: 'inline-flex', color: 'var(--syn-type)' }}>
          {isOpen ? <FolderOpenOutlinedIcon style={{ fontSize: 15 }} /> : <FolderOutlinedIcon style={{ fontSize: 15 }} />}
        </span>
        <span>{loc.name}</span>
      </div>

      {isOpen && hasChildren && loc.sublocations.map((sub) => (
        <LocationRow
          key={sub.name}
          loc={sub}
          path={[...path, sub.name]}
          index={index}
          activeKey={activeKey}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}

      {isActive && loc.exits.length > 0 && (
        <div>
          {loc.exits.map((exit) => {
            const targetEntry = index.entryOf(getByReference<SerializedLocation>(exit.exit));
            // The bare name tells the place apart unless another location has it too; then the whole path does.
            const target = targetEntry && (index.isUnique(targetEntry.location.name) ? targetEntry.location.name : targetEntry.path.join(' \u203a '));
            return (
              <div
                key={exit.name}
                onClick={(e) => { e.stopPropagation(); if (targetEntry) onSelect(targetEntry.path); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: `2px 8px 2px ${8 + (depth + 1) * 14}px`,
                  height: 20, cursor: target ? 'pointer' : 'default',
                  color: 'var(--fg-muted)', fontSize: 11.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                <span style={{ width: 14, display: 'inline-flex', color: 'var(--fg-muted)' }}>
                  <ArrowOutwardIcon style={{ fontSize: 12 }} />
                </span>
                <span>{exit.name} &rarr; {target ?? '?'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { worldState } = useContext(DslContext);
  const names = useLocationRoute();
  const index = useLocationIndex();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const locations = worldState?.World?.locations;
  const active = names && index ? index.resolve(names) : undefined;
  const activeEntry = active?.kind === 'found' ? active.entry : undefined;

  useEffect(() => {
    if (!activeEntry) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let at: typeof activeEntry | undefined = activeEntry; at; at = at.parent) next.add(at.key);
      return next;
    });
  }, [activeEntry]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectLocation = (path: readonly string[]) => navigate(locationRoute(path));

  return (
    <aside className="shell-sidebar">
      <div style={{
        padding: '8px 12px 6px', fontSize: 11, textTransform: 'uppercase',
        color: 'var(--fg-secondary)', letterSpacing: '.04em',
      }}>
        Locations
      </div>
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {!locations && (
          <div style={{ padding: '8px 12px', color: 'var(--fg-muted)', fontStyle: 'italic', fontSize: 12 }}>
            No world loaded
          </div>
        )}
        {index && locations?.map((loc) => (
          <LocationRow
            key={loc.name}
            loc={loc}
            path={[loc.name]}
            index={index}
            activeKey={activeEntry?.key}
            expanded={expanded}
            onToggle={toggleExpand}
            onSelect={selectLocation}
          />
        ))}
      </div>
    </aside>
  );
}
