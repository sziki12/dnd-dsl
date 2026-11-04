// Pure builders of the map's graph (nodes and edges) from the served world - no React, but typed with ReactFlow's
// node and edge shapes. The location page shows one location with its sublocations and the places its exits lead
// to; the world page shows the whole tree, with groups that can be opened.

import type { Edge, Node } from '@xyflow/react';
import type { SerializedAstNode, SerializedLocation, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { assignParallelSlots } from '../edges/edge-geometry';
import { exitTags } from './exit-tags';

export type Resolver = <T extends SerializedAstNode>(ref: SerializedRef | undefined) => T | undefined;

export interface MapGraph {
  nodes: Node[];
  edges: Edge[];
}

const NO_POSITION = { x: 0, y: 0 };

const nodeAt = (id: string, data: Record<string, unknown>, parentId?: string): Node => ({
  id,
  type: 'mapNode',
  position: { ...NO_POSITION },
  data,
  ...(parentId === undefined ? {} : { parentId }),
});

const containsEdge = (from: string, to: string): Edge => ({
  id: `${from}->${to}-sublocation`,
  source: from,
  target: to,
  type: 'floating',
  data: { kind: 'sublocation' },
  style: { strokeWidth: 1 },
});

const exitEdge = (from: string, to: string, exit: SerializedLocation['exits'][number]): Edge => ({
  id: `${from}->${to}-${exit.name}`,
  source: from,
  target: to,
  label: exit.name,
  type: 'floating',
  data: { identifiers: exit.identifiers, tags: exitTags(exit.identifiers), kind: 'exit', arrow: true },
  style: { strokeWidth: 1 },
});

/** Exits that join the same pair of nodes (either direction) get their labels spread so they do not stack. */
function spreadParallelExits(edges: Edge[]): void {
  const exits = edges.filter(e => e.data?.kind === 'exit');
  assignParallelSlots(exits).forEach((slot, i) => { exits[i].data = { ...exits[i].data, slot }; });
}

/** One location (the root), its sublocations as children of it, and a placeholder for every other place an exit leads to. */
export function buildLocationGraph(location: SerializedLocation, resolve: Resolver): MapGraph {
  const nodes: Node[] = [nodeAt(location.name, { location: location.name, type: 'group', kind: 'root' })];
  const edges: Edge[] = [];
  const knownIds = new Set(location.sublocations.map(s => s.name));

  const addExit = (from: string, exit: SerializedLocation['exits'][number]) => {
    const targetName = resolve<SerializedLocation>(exit.exit)?.name ?? 'Unknown';
    if (!knownIds.has(targetName)) {
      knownIds.add(targetName);
      nodes.push(nodeAt(targetName, { location: targetName, kind: 'external' }));
    }
    edges.push(exitEdge(from, targetName, exit));
  };

  for (const exit of location.exits ?? []) addExit(location.name, exit);

  for (const sub of location.sublocations) {
    const isEntry = resolve<SerializedLocation>(location.entry?.entry)?.name === sub.name;
    nodes.push(nodeAt(sub.name, { location: sub.name, isEntry, kind: isEntry ? 'entry' : 'sub' }, location.name));
    edges.push(containsEdge(location.name, sub.name));
    for (const exit of sub.exits ?? []) addExit(sub.name, exit);
  }

  spreadParallelExits(edges);
  return { nodes, edges };
}

interface Entry {
  location: SerializedLocation;
  parent: string | undefined;
}

/**
 * Every location of the world as a node when it is shown: the top-level ones always, a deeper one when every group above
 * it is open. Contains edges join an open group to its children. An exit is drawn between the nearest shown places on its
 * two ends: inside one node it is dropped, and several that join the same two nodes the same way become one edge.
 * `isVisible` lets a caller hide a location (and everything under it) from the map.
 */
export function buildWorldGraph(
  locations: readonly SerializedLocation[],
  expanded: Iterable<string>,
  resolve: Resolver,
  isVisible: (name: string) => boolean = () => true,
): MapGraph {
  const open = new Set(expanded);
  const entries = new Map<string, Entry>();
  const order: string[] = [];
  const collect = (list: readonly SerializedLocation[], parent: string | undefined) => {
    for (const location of list) {
      if (entries.has(location.name)) continue;
      entries.set(location.name, { location, parent });
      order.push(location.name);
      collect(location.sublocations, location.name);
    }
  };
  collect(locations, undefined);

  const shownCache = new Map<string, boolean>();
  const shown = (name: string): boolean => {
    const cached = shownCache.get(name);
    if (cached !== undefined) return cached;
    const entry = entries.get(name)!;
    const parentOpen = entry.parent === undefined || (shown(entry.parent) && open.has(entry.parent));
    const result = parentOpen && isVisible(name);
    shownCache.set(name, result);
    return result;
  };
  const nearestShown = (name: string): string | undefined => {
    for (let at: string | undefined = name; at !== undefined; at = entries.get(at)?.parent) {
      if (shown(at)) return at;
    }
    return undefined;
  };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const name of order) {
    if (!shown(name)) continue;
    const { location, parent } = entries.get(name)!;
    const childCount = location.sublocations.length;
    const isEntry = parent !== undefined && resolve<SerializedLocation>(entries.get(parent)!.location.entry?.entry)?.name === name;
    const kind = parent === undefined ? 'root' : isEntry ? 'entry' : 'sub';
    nodes.push(nodeAt(name, { location: name, kind, isEntry, childCount, expanded: childCount > 0 && open.has(name) }));
    if (parent !== undefined) edges.push(containsEdge(parent, name));
  }

  const bundles = new Map<string, { from: string; to: string; exits: SerializedLocation['exits'] }>();
  for (const name of order) {
    for (const exit of entries.get(name)!.location.exits ?? []) {
      const targetName = resolve<SerializedLocation>(exit.exit)?.name;
      if (targetName === undefined || !entries.has(targetName)) continue;
      const from = nearestShown(name);
      const to = nearestShown(targetName);
      if (from === undefined || to === undefined || from === to) continue;
      const key = `${from}\u0000${to}`;
      const bundle = bundles.get(key);
      if (bundle) bundle.exits.push(exit);
      else bundles.set(key, { from, to, exits: [exit] });
    }
  }
  for (const { from, to, exits } of bundles.values()) {
    if (exits.length === 1) {
      edges.push(exitEdge(from, to, exits[0]));
    } else {
      edges.push({
        id: `${from}->${to}-rollup`,
        source: from,
        target: to,
        label: `${exits.length} exits`,
        type: 'floating',
        data: { identifiers: [], tags: [], kind: 'exit', arrow: true, bundled: exits.length },
        style: { strokeWidth: 1 },
      });
    }
  }

  spreadParallelExits(edges);
  return { nodes, edges };
}

/** What a graph looks like apart from where its nodes are, so the map rebuilds only when something it shows changed. */
export function graphKey(graph: MapGraph): string {
  return JSON.stringify([
    graph.nodes.map(n => [n.id, n.parentId ?? null, n.data]),
    graph.edges.map(e => [e.id, e.source, e.target, e.label ?? null, e.data?.tags ?? null, e.data?.bundled ?? null]),
  ]);
}
