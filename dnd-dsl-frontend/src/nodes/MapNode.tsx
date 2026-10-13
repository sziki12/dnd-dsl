import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeKind } from '../pages/map-view-settings';

const CAPTION: Record<NodeKind, string> = { root: 'location', sub: 'sub', entry: 'sub', external: 'external' };

// Colours, fade and size come from CSS (.map-node in darkplus.css), driven by the settings MapFlow puts on its container.
function MapNode({ data }: any) {
  const kind: NodeKind = data.kind ?? (data.type === 'group' ? 'root' : data.isEntry ? 'entry' : 'sub');

  return (
    <div
      className="map-node px-3 py-2 rounded-md"
      data-kind={kind}
      style={{ color: 'var(--fg-bright)', fontFamily: 'var(--font-ui)' }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }}/>
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }}/>
      <div className="flex">
        <div>
          <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
            {CAPTION[kind]}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{data.location}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </div>
  );
}

export default memo(MapNode);
