// Pure model of the map's live view settings - no React/ReactFlow dependency.
//
// Everything here ends up as CSS custom properties and classes on MapFlow's container (see
// settingsToCssVars / settingsToClasses), so a change repaints the nodes and edges without
// rebuilding the graph and losing positions. The only numeric exception is the node size, which
// the edge component reads to find where a line meets a scaled node (effectiveNodeScale).

import { sanitizeTagRules, type TagRule } from './exit-tags';

export type NodeKind = 'root' | 'sub' | 'entry' | 'external';
export type EdgeKind = 'exit' | 'sublocation';
export type StyleKind = NodeKind | EdgeKind;
/** A colour can be set for everything, for all nodes, for all edges, or for one kind. */
export type ColorScope = 'all' | 'nodes' | 'edges' | StyleKind;
export type NodeSizeMode = 'map' | 'screen';
export type ViewMode = 'map' | 'tree';

export const NODE_KINDS: readonly NodeKind[] = ['root', 'sub', 'entry', 'external'];
export const EDGE_KINDS: readonly EdgeKind[] = ['exit', 'sublocation'];

export const OPACITY_MIN = 0;
export const OPACITY_MAX = 1;
export const SIZE_MIN = 0.5;
export const SIZE_MAX = 2;
/** How much of a node's own colour its fill gets (the rest is the panel background). */
export const FILL_STRENGTH = 28;

export interface MapViewSettings {
  version: 1;
  /** Draw the exit names on the edges. */
  labels: boolean;
  nodes: {
    /** Map mode only. Hidden nodes are not interactive. */
    visible: boolean;
    /** Map mode only. Fades a node's fill and border, not its text. */
    opacity: number;
    /** 'map': scales with the map. 'screen': keeps the same on-screen size at every zoom. */
    sizeMode: NodeSizeMode;
    /** 1 is the normal card size. */
    size: number;
  };
  edges: { visible: boolean };
  /** Only the scopes the user has set; the rest fall back to the theme. */
  colors: Partial<Record<ColorScope, string>>;
  /** How exits with certain tags look, in order; later rules win. */
  tagRules: TagRule[];
}

/** What each kind looks like with no custom colour. Used to show something in the pickers; the real fallback is CSS. */
export const DEFAULT_COLORS: Record<StyleKind, string> = {
  root: '#007acc',
  sub: '#9d9d9d',
  entry: '#89d185',
  external: '#9d9d9d',
  exit: '#9d9d9d',
  sublocation: '#4ec9b0',
};

export function defaultSettings(): MapViewSettings {
  return {
    version: 1,
    labels: true,
    nodes: { visible: true, opacity: 1, sizeMode: 'map', size: 1 },
    edges: { visible: true },
    colors: {},
    tagRules: [],
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const isNodeKind = (scope: ColorScope): scope is NodeKind => (NODE_KINDS as readonly string[]).includes(scope);

const COLOR_SCOPES: readonly ColorScope[] = ['all', 'nodes', 'edges', ...NODE_KINDS, ...EDGE_KINDS];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Anything stored or received becomes a valid settings object: unknown keys dropped, numbers clamped, bad colours ignored. */
export function sanitizeSettings(raw: unknown): MapViewSettings {
  const base = defaultSettings();
  const r = asRecord(raw);
  const nodes = asRecord(r.nodes);
  const edges = asRecord(r.edges);
  const colors = asRecord(r.colors);

  const cleanColors: Partial<Record<ColorScope, string>> = {};
  for (const scope of COLOR_SCOPES) {
    const color = colors[scope];
    if (isHexColor(color)) cleanColors[scope] = color.toLowerCase();
  }

  return {
    version: 1,
    labels: bool(r.labels, base.labels),
    nodes: {
      visible: bool(nodes.visible, base.nodes.visible),
      opacity: clamp(finite(nodes.opacity, base.nodes.opacity), OPACITY_MIN, OPACITY_MAX),
      sizeMode: nodes.sizeMode === 'screen' ? 'screen' : 'map',
      size: clamp(finite(nodes.size, base.nodes.size), SIZE_MIN, SIZE_MAX),
    },
    edges: { visible: bool(edges.visible, base.edges.visible) },
    colors: cleanColors,
    tagRules: sanitizeTagRules(r.tagRules),
  };
}

/**
 * Sets (or clears, with undefined) the colour of one scope. A broader scope also clears the narrower ones under it,
 * so the colour just picked is the one that shows: setting "all" resets every override, "nodes" the node kinds,
 * "edges" the edge kinds.
 */
export function setColor(settings: MapViewSettings, scope: ColorScope, color: string | undefined): MapViewSettings {
  const colors: Partial<Record<ColorScope, string>> = { ...settings.colors };
  const narrower: ColorScope[] =
    scope === 'all' ? ['nodes', 'edges', ...NODE_KINDS, ...EDGE_KINDS]
    : scope === 'nodes' ? [...NODE_KINDS]
    : scope === 'edges' ? [...EDGE_KINDS]
    : [];
  for (const s of narrower) delete colors[s];
  if (color !== undefined && isHexColor(color)) colors[scope] = color.toLowerCase();
  else delete colors[scope];
  return { ...settings, colors };
}

/** True when nothing differs from the defaults (so there is nothing worth storing). */
export function isDefaultSettings(settings: MapViewSettings): boolean {
  return JSON.stringify(sanitizeSettings(settings)) === JSON.stringify(defaultSettings());
}

/** What gets saved for a location: its settings, or an empty object (which clears the entry) when they are the defaults. */
export function settingsToStored(settings: MapViewSettings): MapViewSettings | Record<string, never> {
  return isDefaultSettings(settings) ? {} : settings;
}

/** The colour a kind actually gets: its own, else its group's, else the global one, else undefined (the theme's). */
export function resolveColor(colors: MapViewSettings['colors'], kind: StyleKind): string | undefined {
  return colors[kind] ?? (isNodeKind(kind) ? colors.nodes : colors.edges) ?? colors.all;
}

/** The custom properties MapFlow puts on its container. Kinds with no custom colour get none, so CSS falls back to the theme. */
export function settingsToCssVars(settings: MapViewSettings, mode: ViewMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const kind of [...NODE_KINDS, ...EDGE_KINDS] as StyleKind[]) {
    const color = resolveColor(settings.colors, kind);
    if (!color) continue;
    vars[`--map-color-${kind}`] = color;
    if (isNodeKind(kind)) vars[`--map-fill-${kind}`] = `color-mix(in srgb, ${color} ${FILL_STRENGTH}%, var(--bg-panel))`;
  }
  vars['--map-node-opacity'] = String(mode === 'map' ? settings.nodes.opacity : 1);
  return vars;
}

/** Classes that switch parts of the map off. Hiding and fading nodes is a map-mode setting; the tree always shows them. */
export function settingsToClasses(settings: MapViewSettings, mode: ViewMode): string[] {
  const classes: string[] = [];
  if (!settings.labels) classes.push('map-hide-labels');
  if (mode === 'map' && !settings.nodes.visible) classes.push('map-hide-nodes');
  if (!settings.edges.visible) classes.push('map-hide-edges');
  return classes;
}

/** The factor a node card is drawn at: its size setting, divided by the zoom when it should keep its on-screen size. */
export function effectiveNodeScale(nodes: Pick<MapViewSettings['nodes'], 'sizeMode' | 'size'>, zoom: number): number {
  if (nodes.sizeMode === 'screen' && zoom > 0) return nodes.size / zoom;
  return nodes.size;
}
