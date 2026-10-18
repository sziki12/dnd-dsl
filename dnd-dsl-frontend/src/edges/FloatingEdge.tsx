import { useContext, type CSSProperties } from 'react';
import { EdgeLabelRenderer, getStraightPath, useInternalNode, useStore } from '@xyflow/react';
import { getEdgeParams } from './initialElements';
import { labelPosition, scaledBox, type ParallelSlot } from './edge-geometry';
import { MapViewContext } from '../pages/MapViewContext';
import { effectiveNodeScale } from '../pages/map-view-settings';
import { arrowMarkerId, resolveTagStyle, type ExitTag } from '../pages/exit-tags';

/** Distance between the labels of edges that join the same pair of nodes, in map units at node scale 1. */
const LABEL_SPACING = 18;

type EdgeData = { kind?: string; arrow?: boolean; slot?: ParallelSlot; tags?: ExitTag[] } | undefined;

/** Dash pattern of a tag rule that asks for a dashed exit. */
const DASH = '6 4';

// ReactFlow measures a node's unscaled card, but the card is drawn at the node-size scale, so a line has to
// meet the scaled box (about the node's top-centre anchor) to touch the visible border.
function scaledGeometry(node: { measured: { width?: number; height?: number }; internals: { positionAbsolute: { x: number; y: number } } }, scale: number) {
  const box = scaledBox(
    { ...node.internals.positionAbsolute, width: node.measured.width ?? 0, height: node.measured.height ?? 0 },
    scale,
  );
  return { measured: { width: box.width, height: box.height }, internals: { positionAbsolute: { x: box.x, y: box.y } } };
}

function FloatingEdge({ id, source, target, label, data, style }: {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: EdgeData;
  style?: CSSProperties;
}) {
  const settings = useContext(MapViewContext);
  // Only a fixed on-screen size depends on the zoom, so only then does zooming re-render the edge.
  const zoom = useStore(s => (settings.nodes.sizeMode === 'screen' ? s.transform[2] : 1));
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (
    !sourceNode || !targetNode ||
    !sourceNode.measured?.width || !sourceNode.measured?.height ||
    !targetNode.measured?.width || !targetNode.measured?.height
  ) {
    return null;
  }

  const srcPos = sourceNode.internals.positionAbsolute;
  const tgtPos = targetNode.internals.positionAbsolute;

  // Guard against both nodes at the same position (causes division by zero in getEdgeParams)
  if (srcPos.x === tgtPos.x && srcPos.y === tgtPos.y) {
    return null;
  }

  const scale = effectiveNodeScale(settings.nodes, zoom);
  const { sx, sy, tx, ty } = getEdgeParams(scaledGeometry(sourceNode, scale), scaledGeometry(targetNode, scale));

  if (!isFinite(sx) || !isFinite(sy) || !isFinite(tx) || !isFinite(ty)) {
    return null;
  }

  const [edgePath] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
  // How the exit's tags make it look (colour, width, dash, opacity, a suffix after its name), see exit-tags.ts.
  const look = resolveTagStyle(settings.tagRules, data?.tags ?? []);
  const pathStyle: CSSProperties = {
    ...style,
    ...(look.color !== undefined && { stroke: look.color }),
    ...(look.width !== undefined && { strokeWidth: look.width }),
    ...(look.dash !== undefined && { strokeDasharray: look.dash ? DASH : 'none' }),
    ...(look.opacity !== undefined && { opacity: look.opacity }),
  };
  const name = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
  const text = look.suffix ? `${name} ${look.suffix}`.trim() : name;
  const slot = data?.slot ?? { index: 0, count: 1, flip: false };
  const at = labelPosition({ x: sx, y: sy }, { x: tx, y: ty }, slot, LABEL_SPACING * scale);

  return (
    <>
      <path
        id={id}
        className={`react-flow__edge-path map-edge${data?.kind ? ` map-edge-${data.kind}` : ''}`}
        d={edgePath}
        markerEnd={data?.arrow ? `url(#${look.color ? arrowMarkerId(look.color.slice(1)) : 'map-arrow'})` : undefined}
        style={pathStyle}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className="map-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px) scale(var(--map-node-scale, 1))`,
              ...(look.opacity !== undefined && { opacity: look.opacity }),
            }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default FloatingEdge;
