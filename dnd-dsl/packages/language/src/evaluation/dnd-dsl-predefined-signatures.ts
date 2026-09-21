/**
 * Metadata for every predefined function (`call predefined <name> with ...`): names,
 * parameters, descriptions and whether a statement-position call writes its result back.
 * Implementations stay where they run - the list functions in dnd-dsl-list-ops.ts, the
 * rest in the backend - but the signatures live here so the language server can
 * validate arity and unknown names and offer completion.
 *
 * A parameter name ending in `?` is optional.
 */

export type PredefinedSignature = {
    name: string;
    params: string[];
    description: string;
    /** As a statement, also store the result into the first argument (which must be a
     *  variable). As an expression the function is pure either way. */
    writesBack?: boolean;
};

export const PREDEFINED_SIGNATURES: PredefinedSignature[] = [
    { name: 'randomfv', params: ['min', 'max'], description: 'Returns a random integer between min and max (inclusive).' },

    { name: 'length', params: ['list'], description: 'Number of items in the list.' },
    { name: 'isEmpty', params: ['list'], description: 'Whether the list has no items.' },
    { name: 'contains', params: ['list', 'item'], description: 'Whether the list has an item equal to `item`.' },
    { name: 'indexOf', params: ['list', 'item'], description: 'Index of the first item equal to `item`, or -1.' },
    { name: 'at', params: ['list', 'index'], description: 'The item at a 0-based index, or nothing when out of range.' },
    { name: 'first', params: ['list'], description: 'The first item, or nothing when empty.' },
    { name: 'last', params: ['list'], description: 'The last item, or nothing when empty.' },
    { name: 'sum', params: ['list'], description: 'Sum of a list of numbers (0 when empty).' },
    { name: 'min', params: ['list'], description: 'Smallest number in the list, or nothing when empty.' },
    { name: 'max', params: ['list'], description: 'Largest number in the list, or nothing when empty.' },
    { name: 'join', params: ['list', 'separator?'], description: 'The items as one string, separated by `separator` (default ", ").' },
    { name: 'slice', params: ['list', 'start', 'end?'], description: 'A new list of the items from `start` up to (not including) `end`.' },
    { name: 'pickRandom', params: ['list'], description: 'A random item of the list.' },

    { name: 'append', params: ['list', 'item'], description: 'The list with `item` added at the end.', writesBack: true },
    { name: 'prepend', params: ['list', 'item'], description: 'The list with `item` added at the start.', writesBack: true },
    { name: 'insertAt', params: ['list', 'index', 'item'], description: 'The list with `item` inserted at `index` (clamped to the list).', writesBack: true },
    { name: 'removeAt', params: ['list', 'index'], description: 'The list without the item at `index` (unchanged when out of range).', writesBack: true },
    { name: 'remove', params: ['list', 'item'], description: 'The list without the first item equal to `item`.', writesBack: true },
    { name: 'concat', params: ['list', 'other'], description: 'The list followed by the items of `other`.', writesBack: true },
    { name: 'reverse', params: ['list'], description: 'The list in reverse order.', writesBack: true },
    { name: 'sort', params: ['list'], description: 'The list sorted ascending (only numbers or only strings).', writesBack: true },
    { name: 'unique', params: ['list'], description: 'The list without repeated items.', writesBack: true },
    { name: 'shuffle', params: ['list'], description: 'The list in random order.', writesBack: true },
];

const BY_NAME = new Map(PREDEFINED_SIGNATURES.map(sig => [sig.name, sig]));

export function getPredefinedSignature(name: string): PredefinedSignature | undefined {
    return BY_NAME.get(name);
}

/** Accepted argument counts: every parameter without a trailing `?` is required. */
export function predefinedArity(sig: PredefinedSignature): { min: number; max: number } {
    return { min: sig.params.filter(p => !p.endsWith('?')).length, max: sig.params.length };
}
