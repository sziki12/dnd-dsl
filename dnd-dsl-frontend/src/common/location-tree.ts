import type { SerializedLocation } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

export function findLocation(locations: SerializedLocation[], name: string): SerializedLocation | undefined {
  for (const loc of locations) {
    if (loc.name === name) return loc;
    const found = findLocation(loc.sublocations, name);
    if (found) return found;
  }
  return undefined;
}

/** Returns the ancestor chain (root-first) ending with the matched location, or undefined if not found. */
export function findPathToLocation(locations: SerializedLocation[], name: string): SerializedLocation[] | undefined {
  for (const loc of locations) {
    if (loc.name === name) return [loc];
    const found = findPathToLocation(loc.sublocations, name);
    if (found) return [loc, ...found];
  }
  return undefined;
}
