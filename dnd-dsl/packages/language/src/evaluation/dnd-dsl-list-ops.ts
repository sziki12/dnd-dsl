/**
 * Pure list operations behind the predefined list functions, plus the deep equality
 * the comparison operators use. Every function returns a new value and never mutates
 * its inputs - readPersistentValue hands out arrays straight from the served world
 * state, so an in-place change would corrupt it and the undo snapshots.
 *
 * No Langium imports, so this is safe in the browser frontend and the Node backend.
 */

/** Deep for arrays, identity for everything else (records keep identity semantics). */
export function valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((value, i) => valuesEqual(value, b[i]));
    }
    return a === b;
}

function asList(fn: string, value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${fn}: first argument must be a list`);
    return value;
}

function asInteger(fn: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${fn}: index must be a whole number`);
    return value;
}

function asNumbers(fn: string, list: unknown[]): number[] {
    if (!list.every(v => typeof v === 'number')) throw new Error(`${fn}: list contains a non-number`);
    return list as number[];
}

export function length(list: unknown): number {
    return asList('length', list).length;
}

export function isEmpty(list: unknown): boolean {
    return asList('isEmpty', list).length === 0;
}

export function contains(list: unknown, item: unknown): boolean {
    return asList('contains', list).some(v => valuesEqual(v, item));
}

export function indexOf(list: unknown, item: unknown): number {
    return asList('indexOf', list).findIndex(v => valuesEqual(v, item));
}

export function at(list: unknown, index: unknown): unknown {
    return asList('at', list)[asInteger('at', index)];
}

export function first(list: unknown): unknown {
    return asList('first', list)[0];
}

export function last(list: unknown): unknown {
    const items = asList('last', list);
    return items[items.length - 1];
}

export function sum(list: unknown): number {
    return asNumbers('sum', asList('sum', list)).reduce((total, v) => total + v, 0);
}

export function min(list: unknown): number | undefined {
    const numbers = asNumbers('min', asList('min', list));
    return numbers.length === 0 ? undefined : Math.min(...numbers);
}

export function max(list: unknown): number | undefined {
    const numbers = asNumbers('max', asList('max', list));
    return numbers.length === 0 ? undefined : Math.max(...numbers);
}

export function join(list: unknown, separator: unknown = ', '): string {
    return asList('join', list)
        .map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join(String(separator));
}

export function slice(list: unknown, start: unknown, end?: unknown): unknown[] {
    return asList('slice', list).slice(
        asInteger('slice', start),
        end === undefined ? undefined : asInteger('slice', end),
    );
}

export function pickRandom(list: unknown): unknown {
    const items = asList('pickRandom', list);
    return items[Math.floor(Math.random() * items.length)];
}

export function append(list: unknown, item: unknown): unknown[] {
    return [...asList('append', list), item];
}

export function prepend(list: unknown, item: unknown): unknown[] {
    return [item, ...asList('prepend', list)];
}

export function insertAt(list: unknown, index: unknown, item: unknown): unknown[] {
    const items = asList('insertAt', list);
    const at = Math.min(Math.max(asInteger('insertAt', index), 0), items.length);
    return [...items.slice(0, at), item, ...items.slice(at)];
}

export function removeAt(list: unknown, index: unknown): unknown[] {
    const items = asList('removeAt', list);
    const at = asInteger('removeAt', index);
    return at < 0 || at >= items.length ? [...items] : [...items.slice(0, at), ...items.slice(at + 1)];
}

export function remove(list: unknown, item: unknown): unknown[] {
    const items = asList('remove', list);
    const at = items.findIndex(v => valuesEqual(v, item));
    return at < 0 ? [...items] : [...items.slice(0, at), ...items.slice(at + 1)];
}

export function concat(list: unknown, other: unknown): unknown[] {
    const items = asList('concat', list);
    if (!Array.isArray(other)) throw new Error('concat: second argument must be a list');
    return [...items, ...other];
}

export function reverse(list: unknown): unknown[] {
    return [...asList('reverse', list)].reverse();
}

export function sort(list: unknown): unknown[] {
    const items = [...asList('sort', list)];
    const allNumbers = items.every(v => typeof v === 'number');
    const allStrings = items.every(v => typeof v === 'string');
    if (!allNumbers && !allStrings) throw new Error('sort: list must contain only numbers or only strings');
    return items.sort((a, b) => ((a as number | string) < (b as number | string) ? -1 : (a as number | string) > (b as number | string) ? 1 : 0));
}

export function unique(list: unknown): unknown[] {
    const result: unknown[] = [];
    for (const item of asList('unique', list)) {
        if (!result.some(v => valuesEqual(v, item))) result.push(item);
    }
    return result;
}

export function shuffle(list: unknown): unknown[] {
    const items = [...asList('shuffle', list)];
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

/** Implementation of each list function in PREDEFINED_SIGNATURES, keyed by name. */
export const LIST_FUNCTIONS: Record<string, (...args: any[]) => unknown> = {
    length, isEmpty, contains, indexOf, at, first, last, sum, min, max, join, slice,
    pickRandom, append, prepend, insertAt, removeAt, remove, concat, reverse, sort,
    unique, shuffle,
};
