import { memo, useContext } from 'react';
import { Handle, Position } from '@xyflow/react';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { NodeKind } from '../pages/map-view-settings';
import { MapGroupContext } from '../pages/MapViewContext';

const CAPTION: Record<NodeKind, string> = { root: 'location', sub: 'sub', entry: 'sub', external: 'external' };

// Colours, fade and size come from CSS (.map-node in darkplus.css), driven by the settings MapFlow puts on its container.
function MapNode({ id, data }: any) {
  const kind: NodeKind = data.kind ?? (data.type === 'group' ? 'root' : data.isEntry ? 'entry' : 'sub');
  const toggleGroup = useContext(MapGroupContext);
  const childCount: number = typeof data.childCount === 'number' ? data.childCount : 0;
  const isGroup = toggleGroup !== null && childCount > 0;

  return (
    <div
      className="map-node px-3 py-2 rounded-md"
      data-kind={kind}
      style={{ color: 'var(--fg-bright)', fontFamily: 'var(--font-ui)' }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }}/>
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }}/>
      <div className="flex" style={{ alignItems: 'center', gap: 6 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
            {CAPTION[kind]}{isGroup ? ` · ${childCount}` : ''}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{data.location}</div>
        </div>
        {isGroup && (
          <button
            type="button"
            className="nodrag nopan map-node-toggle"
            title={data.expanded ? 'Hide the sublocations' : 'Show the sublocations'}
            aria-expanded={!!data.expanded}
            onClick={e => { e.stopPropagation(); toggleGroup(String(id)); }}
            onDoubleClick={e => e.stopPropagation()}
          >
            {data.expanded ? <ExpandMoreIcon style={{ fontSize: 16 }} /> : <ChevronRightIcon style={{ fontSize: 16 }} />}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </div>
  );
}

export default memo(MapNode);
