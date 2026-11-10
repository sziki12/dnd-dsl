// Pure builders of the map's graph (nodes and edges) from the served world - no React, but typed with ReactFlow's
// node and edge shapes. The location page shows one location with its sublocations and the places its exits lead
// to; the world page shows the whole tree, with groups that can be opened.

import type { Edge, Node } from '@xyflow/react';
import type { SerializedAstNode, SerializedLocation, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { assignParallelSlots } from '../edges/edge-geometry';
import { canonicalKeys, indexLocations, locationKey, type LocationEntry, type LocationIndex } from '../common/location-identity';
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

// legacyId is set only while the location's old bare-name id is its alone.
const identityData = (entry: LocationEntry<SerializedLocation>) => ({
  location: entry.location.name,
  path: entry.path,
  ...(entry.legacyKey === undefined ? {} : { legacyId: entry.legacyKey }),
});

/** One location (the root), its sublocations as children of it, and a placeholder for every other place an exit leads to. */
export function buildLocationGraph(location: SerializedLocation, resolve: Resolver, worldIndex: LocationIndex<SerializedLocation>): MapGraph {
  // A location the world does not hold is drawn as a top-level one, with the sublocations it carries.
  const index = worldIndex.entryOf(location) ? worldIndex : indexLocations([location]);
  const here = index.entryOf(location)!;
  const entryOf = (node: SerializedLocation) => index.entryOf(node);

  const nodes: Node[] = [nodeAt(here.key, { ...identityData(here), type: 'group', kind: 'root' })];
  const edges: Edge[] = [];
  const knownIds = new Set(location.sublocations.flatMap(sub => entryOf(sub)?.key ?? []));

  const addExit = (from: string, exit: SerializedLocation['exits'][number]) => {
    const target = resolve<SerializedLocation>(exit.exit);
    const entry = target && entryOf(target);
    const id = entry?.key ?? locationKey([target?.name ?? 'Unknown']);
    if (!knownIds.has(id)) {
      knownIds.add(id);
      nodes.push(nodeAt(id, entry ? { ...identityData(entry), kind: 'external' } : { location: target?.name ?? 'Unknown', kind: 'external' }));
    }
    edges.push(exitEdge(from, id, exit));
  };

  for (const exit of location.exits ?? []) addExit(here.key, exit);

  for (const sub of location.sublocations) {
    const entry = entryOf(sub);
    if (!entry) continue;
    const isEntry = resolve<SerializedLocation>(location.entry?.entry) === sub;
    nodes.push(nodeAt(entry.key, { ...identityData(entry), isEntry, kind: isEntry ? 'entry' : 'sub' }, here.key));
    edges.push(containsEdge(here.key, entry.key));
    for (const exit of sub.exits ?? []) addExit(entry.key, exit);
  }

  spreadParallelExits(edges);
  return { nodes, edges };
}

/**
 * Every location of the world as a node when it is shown: the top-level ones always, a deeper one when every group above
 * it is open. Contains edges join an open group to its children. An exit is drawn between the nearest shown places on its
 * two ends: inside one node it is dropped, and several that join the same two nodes the same way become one edge.
 * `expanded` holds the keys of the open groups (an old bare name is read as the key of the one location that had it).
 * `isVisible` lets a caller hide a location (and everything under it) from the map.
 */
export function buildWorldGraph(
  locations: readonly SerializedLocation[],
  expanded: Iterable<string>,
  resolve: Resolver,
  isVisible: (key: string) => boolean = () => true,
): MapGraph {
  const index = indexLocations(locations);
  const open = new Set(canonicalKeys(index, [...expanded]));
  const entries = new Map(index.entries.map(entry => [entry.key, entry]));

  const shownCache = new Map<string, boolean>();
  const shown = (key: string): boolean => {
    const cached = shownCache.get(key);
    if (cached !== undefined) return cached;
    const parent = entries.get(key)!.parent;
    const parentOpen = parent === undefined || (shown(parent.key) && open.has(parent.key));
    const result = parentOpen && isVisible(key);
    shownCache.set(key, result);
    return result;
  };
  const nearestShown = (key: string): string | undefined => {
    for (let at: LocationEntry<SerializedLocation> | undefined = entries.get(key); at !== undefined; at = at.parent) {
      if (shown(at.key)) return at.key;
    }
    return undefined;
  };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const entry of index.entries) {
    if (!shown(entry.key)) continue;
    const { location, parent } = entry;
    const childCount = location.sublocations.length;
    const isEntry = parent !== undefined && resolve<SerializedLocation>(parent.location.entry?.entry) === location;
    const kind = parent === undefined ? 'root' : isEntry ? 'entry' : 'sub';
    nodes.push(nodeAt(entry.key, { ...identityData(entry), kind, isEntry, childCount, expanded: childCount > 0 && open.has(entry.key) }));
    if (parent !== undefined) edges.push(containsEdge(parent.key, entry.key));
  }

  const bundles = new Map<string, { from: string; to: string; exits: SerializedLocation['exits'] }>();
  for (const entry of index.entries) {
    for (const exit of entry.location.exits ?? []) {
      const target = index.entryOf(resolve<SerializedLocation>(exit.exit));
      if (!target) continue;
      const from = nearestShown(entry.key);
      const to = nearestShown(target.key);
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
