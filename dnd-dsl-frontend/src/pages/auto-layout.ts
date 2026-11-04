// Pure auto layout for the map - no React/ReactFlow dependency.
//
// A deterministic force layout (fixed start, fixed number of steps) that only places the nodes that have no
// position yet: nodes that already have one are pinned where they are, and still push the new ones away.
// Positions in and out are the normalized fractions of the map rect that the layout file stores.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { Rect } from './map-coords';

export type NormPos = { x: number; y: number };

export interface LayoutNode {
  id: string;
  /** Set when the saved position is relative to another node (the location map's sublocations). */
  parentId?: string;
}

export interface LayoutLink {
  source: string;
  target: string;
}

/** Distance, in map units, a node keeps from the next one. A card is about 150 wide. */
export const NODE_RADIUS = 90;
/** How far a node that starts next to another one is put from it. */
export const SPAWN_RADIUS = 190;
const LINK_DISTANCE = 230;
const CHARGE = -520;
const PULL_TO_CENTRE = 0.04;
const STEPS = 300;
const MARGIN_X = 90;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 90;

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/** `count` points evenly spread on a circle around (cx, cy), the first one straight above. */
export function ringPoint(cx: number, cy: number, radius: number, index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: cx, y: cy };
  const angle = (2 * Math.PI * index) / count - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/**
 * Positions for every node. `known` holds the ones that are already placed (absolute, or relative to the parent for
 * a node with a parentId); those come back unchanged. A node may start `near` another one (its parent, usually).
 */
export function placeNodes(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  known: Readonly<Record<string, NormPos>>,
  rect: Rect,
  near: Readonly<Record<string, string>> = {},
): Record<string, NormPos> {
  const result: Record<string, NormPos> = {};
  const byId = new Map(nodes.map(n => [n.id, n]));
  const has = (id: string) => Object.prototype.hasOwnProperty.call(known, id);
  const toMap = (p: NormPos) => ({ x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height });
  const toNorm = (x: number, y: number): NormPos => ({ x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height });

  // Where each node is in map space once a position is known for it and (for a child) for its parent.
  const absolute = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (!has(node.id)) continue;
    if (node.parentId === undefined || !byId.has(node.parentId)) {
      absolute.set(node.id, toMap(known[node.id]));
    }
  }
  for (const node of nodes) {
    if (!has(node.id) || node.parentId === undefined || !byId.has(node.parentId)) continue;
    const parent = absolute.get(node.parentId);
    if (parent) {
      const rel = known[node.id];
      absolute.set(node.id, { x: parent.x + rel.x * rect.width, y: parent.y + rel.y * rect.height });
    }
  }

  // A child that has a position relative to a parent that has none keeps it; the parent is placed by the layout.
  const pinnedRelative = (node: LayoutNode) => has(node.id) && !absolute.has(node.id);
  const free = nodes.filter(n => !absolute.has(n.id) && !pinnedRelative(n));

  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const start = new Map<string, { x: number; y: number }>();

  // Start positions: next to the node they belong to if it is placed, else spread on a circle around the middle.
  const loose = free.filter(n => !(near[n.id] !== undefined && (absolute.has(near[n.id]) || free.some(f => f.id === near[n.id]))));
  loose.forEach((n, i) => {
    const p = ringPoint(centre.x, centre.y, 0.3 * Math.min(rect.width, rect.height), i, loose.length);
    start.set(n.id, p);
  });
  const siblings = new Map<string, string[]>();
  for (const n of free) {
    const anchor = near[n.id];
    if (anchor === undefined || start.has(n.id)) continue;
    siblings.set(anchor, [...(siblings.get(anchor) ?? []), n.id]);
  }
  for (const [anchor, members] of siblings) {
    const at = absolute.get(anchor) ?? start.get(anchor) ?? centre;
    members.forEach((id, i) => start.set(id, ringPoint(at.x, at.y, SPAWN_RADIUS, i, members.length)));
  }

  const simNodes: SimNode[] = nodes
    .filter(n => !pinnedRelative(n))
    .map(n => {
      const p = absolute.get(n.id) ?? start.get(n.id) ?? centre;
      const node: SimNode = { id: n.id, x: p.x, y: p.y };
      if (absolute.has(n.id)) { node.fx = p.x; node.fy = p.y; }
      return node;
    });
  const simIds = new Set(simNodes.map(n => n.id));
  const simLinks = links.filter(l => simIds.has(l.source) && simIds.has(l.target) && l.source !== l.target).map(l => ({ source: l.source, target: l.target }));

  if (free.length > 0) {
    forceSimulation(simNodes)
      .force('link', forceLink<SimNode, { source: string; target: string }>(simLinks).id(d => d.id).distance(LINK_DISTANCE).strength(0.35))
      .force('charge', forceManyBody().strength(CHARGE))
      .force('collide', forceCollide(NODE_RADIUS))
      .force('x', forceX(centre.x).strength(PULL_TO_CENTRE))
      .force('y', forceY(centre.y).strength(PULL_TO_CENTRE))
      .stop()
      .tick(STEPS);
  }

  const clampX = (x: number) => Math.min(Math.max(x, rect.x + MARGIN_X), rect.x + rect.width - MARGIN_X);
  const clampY = (y: number) => Math.min(Math.max(y, rect.y + MARGIN_TOP), rect.y + rect.height - MARGIN_BOTTOM);
  const placed = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) {
    placed.set(n.id, absolute.has(n.id) ? { x: n.x ?? 0, y: n.y ?? 0 } : { x: clampX(n.x ?? centre.x), y: clampY(n.y ?? centre.y) });
  }

  for (const node of nodes) {
    if (has(node.id) && (absolute.has(node.id) || pinnedRelative(node))) {
      result[node.id] = { ...known[node.id] };
      continue;
    }
    const abs = placed.get(node.id) ?? centre;
    const parent = node.parentId !== undefined ? placed.get(node.parentId) ?? absolute.get(node.parentId) : undefined;
    result[node.id] = parent ? toNorm(abs.x - parent.x + rect.x, abs.y - parent.y + rect.y) : toNorm(abs.x, abs.y);
  }
  return result;
}
