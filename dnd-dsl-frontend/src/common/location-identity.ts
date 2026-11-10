// A location is identified by the names from its top-level location down to it: sublocations only have to be unique
// among their siblings, so a bare name can belong to several. A top-level location is its bare name, as it always was.
// Pure - no React - so the route, the map ids and the stored keys can be tested without a browser.

export interface LocationLike {
  name: string;
  sublocations: readonly LocationLike[];
}

export const KEY_SEPARATOR = '›';

const escapeName = (name: string) => name.replace(/%/g, '%25').replace(/›/g, '%3E');

/**
 * The path as one string: the id of the location's node on the maps and the key its layout, view settings and map image
 * are filed under. `%` and the separator are escaped, so two different paths never share a key; a name without them is
 * unchanged, so a top-level location keeps the key it was always filed under.
 */
export const locationKey = (path: readonly string[]): string => path.map(escapeName).join(KEY_SEPARATOR);

export const locationRoute = (path: readonly string[]): string => `/location/${path.map(encodeURIComponent).join('/')}`;

const ROUTE_PREFIX = '/location/';

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Splits the raw path, not the router's splat parameter, which would turn a name containing a slash (`%2F`) into two. */
export function parseLocationRoute(pathname: string): string[] | undefined {
  if (!pathname.startsWith(ROUTE_PREFIX)) return undefined;
  const names = pathname.slice(ROUTE_PREFIX.length).split('/').filter(segment => segment !== '').map(decode);
  return names.length > 0 ? names : undefined;
}

export interface LocationEntry<T extends LocationLike = LocationLike> {
  location: T;
  path: readonly string[];
  key: string;
  parent: LocationEntry<T> | undefined;
  children: LocationEntry<T>[];
  /**
   * The key this location was filed under while every name was unique in the world: its bare name. Set only while that
   * name is this location's alone and differs from its key, and only used to read what was saved back then.
   */
  legacyKey: string | undefined;
}

export type RouteMatch<T extends LocationLike = LocationLike> =
  | { kind: 'found'; entry: LocationEntry<T> }
  | { kind: 'ambiguous'; candidates: LocationEntry<T>[] }
  | { kind: 'missing' };

export interface LocationIndex<T extends LocationLike = LocationLike> {
  /** Every location, parents before their children, siblings in the order they are written. */
  entries: readonly LocationEntry<T>[];
  /** The entry of a node of the indexed world (the very object, not one of the same name). */
  entryOf(location: object | undefined): LocationEntry<T> | undefined;
  byKey(key: string): LocationEntry<T> | undefined;
  isUnique(name: string): boolean;
  /**
   * Follows the names from the top-level locations. A lone name that is no top-level location falls back to the
   * sublocation of that name (an address from before names could repeat): found if one has it, ambiguous if several.
   */
  resolve(names: readonly string[]): RouteMatch<T>;
}

const leafOf = (entry: LocationEntry<LocationLike>) => entry.path[entry.path.length - 1];

export function indexLocations<T extends LocationLike>(locations: readonly T[]): LocationIndex<T> {
  const entries: LocationEntry<T>[] = [];
  const roots: LocationEntry<T>[] = [];
  const byObject = new Map<object, LocationEntry<T>>();
  const byKey = new Map<string, LocationEntry<T>>();
  const leafCount = new Map<string, number>();

  const collect = (list: readonly T[], parent: LocationEntry<T> | undefined) => {
    for (const location of list) {
      const path = parent ? [...parent.path, location.name] : [location.name];
      const key = locationKey(path);
      // Two siblings of one name is an error in the world; the first is the one shown.
      if (byKey.has(key)) continue;
      const entry: LocationEntry<T> = { location, path, key, parent, children: [], legacyKey: undefined };
      entries.push(entry);
      byObject.set(location, entry);
      byKey.set(key, entry);
      leafCount.set(location.name, (leafCount.get(location.name) ?? 0) + 1);
      (parent ? parent.children : roots).push(entry);
      collect(location.sublocations as readonly T[], entry);
    }
  };
  collect(locations, undefined);

  for (const entry of entries) {
    const name = leafOf(entry);
    if (leafCount.get(name) === 1 && name !== entry.key) entry.legacyKey = name;
  }

  return {
    entries,
    entryOf: location => (location ? byObject.get(location) : undefined),
    byKey: key => byKey.get(key),
    isUnique: name => leafCount.get(name) === 1,
    resolve(names) {
      let entry: LocationEntry<T> | undefined;
      let level = roots;
      for (const name of names) {
        entry = level.find(candidate => leafOf(candidate) === name);
        if (!entry) break;
        level = entry.children;
      }
      if (entry && names.length > 0) return { kind: 'found', entry };
      if (names.length !== 1) return { kind: 'missing' };
      const same = entries.filter(candidate => leafOf(candidate) === names[0]);
      if (same.length === 1) return { kind: 'found', entry: same[0] };
      return same.length > 1 ? { kind: 'ambiguous', candidates: same } : { kind: 'missing' };
    },
  };
}

/** Saved keys written the current way: a bare name that only one nested location answers to becomes that location's key. */
export function canonicalKeys(index: LocationIndex, saved: readonly string[]): string[] {
  const legacy = new Map<string, string>();
  for (const entry of index.entries) if (entry.legacyKey !== undefined) legacy.set(entry.legacyKey, entry.key);
  const result = new Set<string>();
  for (const item of saved) result.add(index.byKey(item) ? item : legacy.get(item) ?? item);
  return [...result];
}

/**
 * What was saved under the key, else what was saved under the key the location had before (when it had one). The
 * second says it came from there, so the caller can move it to the current key.
 */
export async function readWithLegacy<T extends object>(
  read: (key: string) => Promise<T>,
  key: string,
  legacyKey: string | undefined,
): Promise<{ value: T; fromLegacy: boolean }> {
  const value = await read(key);
  if (legacyKey === undefined || Object.keys(value).length > 0) return { value, fromLegacy: false };
  const old = await read(legacyKey);
  return Object.keys(old).length > 0 ? { value: old, fromLegacy: true } : { value, fromLegacy: false };
}

/** Values saved by node id, with the ones saved under a node's old id also reachable by its current id. */
export function withLegacyKeys<V>(values: Readonly<Record<string, V>>, nodes: ReadonlyArray<{ id: string; legacyId?: string }>): Record<string, V> {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(values, key);
  const result: Record<string, V> = { ...values };
  for (const { id, legacyId } of nodes) {
    if (legacyId !== undefined && !has(id) && has(legacyId)) result[id] = values[legacyId];
  }
  return result;
}
