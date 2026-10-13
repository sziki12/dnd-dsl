// Pure geometry for the map's edges - no React/ReactFlow dependency.

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/**
 * The box a node card covers when it is drawn at `scale`. The card is scaled about its top-centre, which is
 * the node's anchor (nodeOrigin [0.5, 0]), so the top edge stays put and the sides grow or shrink evenly.
 * ReactFlow measures the unscaled card, so edges use this to find the border a line meets.
 */
export function scaledBox(box: Box, scale: number): Box {
  return {
    x: box.x + (box.width * (1 - scale)) / 2,
    y: box.y,
    width: box.width * scale,
    height: box.height * scale,
  };
}

export interface ParallelSlot {
  /** Position among the edges that join the same two nodes (in either direction). */
  index: number;
  count: number;
  /** True when the edge runs against the canonical direction (source name after target name). */
  flip: boolean;
}

/** One slot per edge, grouped by the unordered pair of nodes it joins, in input order. */
export function assignParallelSlots(edges: ReadonlyArray<{ source: string; target: string }>): ParallelSlot[] {
  const pairKey = (e: { source: string; target: string }) => (e.source <= e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`);
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(pairKey(e), (counts.get(pairKey(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return edges.map(e => {
    const key = pairKey(e);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return { index, count: counts.get(key)!, flip: e.source > e.target };
  });
}

/**
 * Where to put a label: the middle of the line, moved sideways so edges sharing a pair of nodes (including the
 * opposite direction) do not stack their labels. The sideways direction is the same for both directions of a pair,
 * so they end up on opposite sides.
 */
export function labelPosition(from: Point, to: Point, slot: ParallelSlot, spacing: number): Point {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0 || slot.count <= 1) return mid;
  const side = (slot.index - (slot.count - 1) / 2) * spacing * (slot.flip ? -1 : 1);
  return { x: mid.x + (-dy / length) * side, y: mid.y + (dx / length) * side };
}
