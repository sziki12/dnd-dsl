import { useContext, useMemo, useState } from 'react';
import { parseReferenceFromSerializedModel } from '@dnd-language/evaluation/dnd-dsl-reference.js';
import type { SerializedAstNode, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { DslContext } from '../contexts/DslContext.js';
import { graphKey, type MapGraph, type Resolver } from './map-graph';
import type { NormPos } from './auto-layout';

/** The scope the world map files its layout, view settings and image under. A location of this name is refused by the validator. */
export const WORLD_MAP_KEY = '$world';

/**
 * Keeps only normalized-fraction entries from a saved layout file. Older saves
 * wrote raw container pixels (values in the hundreds, sometimes negative); fed
 * through normalizedToPixel those land thousands of pixels off-canvas, so drop
 * them and let the node be placed again.
 */
export function sanitizeLayout(raw: Record<string, NormPos> | null | undefined): Record<string, NormPos> {
  const out: Record<string, NormPos> = {};
  for (const [id, p] of Object.entries(raw ?? {})) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.5 && p.x <= 1.5 && p.y >= -0.5 && p.y <= 1.5) {
      out[id] = { x: p.x, y: p.y };
    }
  }
  return out;
}

/** Turns a reference in the served world into the node it points at; stays the same function until the world changes. */
export function useReferenceResolver(): Resolver {
  const { worldState } = useContext(DslContext);
  return useMemo<Resolver>(
    () => (<T extends SerializedAstNode>(ref: SerializedRef | undefined) => (worldState && ref ? parseReferenceFromSerializedModel<T>(worldState, ref) : undefined)),
    [worldState],
  );
}

/** The last graph whose content differs from this one, so a rebuild that changes nothing does not re-lay the map out. */
export function useStableGraph(graph: MapGraph | undefined): MapGraph | undefined {
  const [stable, setStable] = useState(graph);
  const next = graph === undefined ? undefined : stable !== undefined && graphKey(stable) === graphKey(graph) ? stable : graph;
  if (next !== stable) setStable(next);
  return next;
}

