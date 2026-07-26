import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

function MapNode({ data }: any) {
  const isRoot = data.type === 'group';
  const isEntry = !!data.isEntry;
  // border mirrors this node's edge color: sublocation ≈ --syn-type, exit-target/root ≈ --fg-secondary
  const borderColor = isRoot ? 'var(--accent)' : isEntry ? 'var(--ok)' : 'var(--fg-secondary)';

  return (
    <div
      className="px-3 py-2 rounded-md shadow-md"
      style={{
        background: isRoot ? 'var(--accent-soft)' : 'var(--bg-panel)',
        border: `1.5px solid ${borderColor}`,
        color: 'var(--fg-bright)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }}/>
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }}/>
      <div className="flex">
        <div>
          <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
            {isRoot ? 'location' : 'sub'}
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
