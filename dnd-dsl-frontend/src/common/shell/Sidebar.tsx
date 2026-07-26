import { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { DslContext } from '../../contexts/DslContext';
import { findPathToLocation } from '../location-tree';
import type { SerializedLocation } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

function LocationRow({
  loc, depth, activeName, expanded, onToggle, onSelect,
}: {
  loc: SerializedLocation;
  depth: number;
  activeName: string | undefined;
  expanded: Set<string>;
  onToggle: (name: string) => void;
  onSelect: (name: string) => void;
}) {
  const { getByReference } = useContext(DslContext);
  const hasChildren = loc.sublocations.length > 0;
  const isOpen = expanded.has(loc.name);
  const isActive = loc.name === activeName;

  return (
    <div>
      <div
        className="tree-row"
        onClick={() => {
          if (hasChildren) onToggle(loc.name);
          onSelect(loc.name);
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
          depth={depth + 1}
          activeName={activeName}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}

      {isActive && loc.exits.length > 0 && (
        <div>
          {loc.exits.map((exit) => {
            const target = getByReference<SerializedLocation>(exit.exit)?.name;
            return (
              <div
                key={exit.name}
                onClick={(e) => { e.stopPropagation(); if (target) onSelect(target); }}
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
  const { locationName } = useParams();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const locations = worldState?.World?.locations;

  useEffect(() => {
    if (!locations || !locationName) return;
    const path = findPathToLocation(locations, locationName);
    if (!path) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      path.forEach((loc) => next.add(loc.name));
      return next;
    });
  }, [locations, locationName]);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectLocation = (name: string) => navigate(`/location/${encodeURIComponent(name)}`);

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
        {locations?.map((loc) => (
          <LocationRow
            key={loc.name}
            loc={loc}
            depth={0}
            activeName={locationName}
            expanded={expanded}
            onToggle={toggleExpand}
            onSelect={selectLocation}
          />
        ))}
      </div>
    </aside>
  );
}
