/**
 * On-disk shape of a world's `<world>.state.json` sidecar — the "live state" layer
 * separated from the `.dnd` "logic"/"defaults" layer. Only entries that actually
 * differ from their `.dnd`-declared default need to be present; "reset to default"
 * is just deleting an entry (or the whole file).
 */
export type StateOverlayFile = {
    /** Bumped if this shape changes, so a future version can detect/migrate an old file instead of crashing on it. */
    version: 1;
    /** key = encodeStatePath(path) from dnd-dsl-state-path.ts; value = the current (overridden) value. */
    entries: Record<string, unknown>;
};

export const EMPTY_STATE_OVERLAY: StateOverlayFile = { version: 1, entries: {} };
