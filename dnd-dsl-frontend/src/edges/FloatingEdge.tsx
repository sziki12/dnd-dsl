import { getStraightPath, useInternalNode } from '@xyflow/react';
import { getEdgeParams } from './initialElements';

function FloatingEdge({ id, source, target, markerStart, markerEnd, style }: {
  id: string;
  source: string;
  target: string;
  markerStart?: any;
  markerEnd?: any;
  style?: any;
}) {
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

  const { sx, sy, tx, ty } = getEdgeParams(sourceNode as any, targetNode as any);

  if (!isFinite(sx) || !isFinite(sy) || !isFinite(tx) || !isFinite(ty)) {
    return null;
  }

  const [edgePath] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });

  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={edgePath}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
    />
  );
}

export default FloatingEdge;
