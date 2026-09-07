import type { FiredReminder, ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders.js';

/**
 * On-disk shape of a world's `<world>.state.json` sidecar — the "live state" layer
 * separated from the `.dnd` "logic"/"defaults" layer. Only entries that actually
 * differ from their `.dnd`-declared default need to be present; "reset to default"
 * is just deleting an entry (or the whole file).
 *
 * clock/reminders/firedReminders are optional siblings of entries rather than more
 * entries themselves: entries is specifically "override of a value at a real
 * .dnd-declared AST node," and there is no AST node for a clock or a reminder queue.
 */
export type StateOverlayFile = {
    /** Bumped if this shape changes, so a future version can detect/migrate an old file instead of crashing on it. */
    version: 1;
    /** key = encodeStatePath(path) from dnd-dsl-state-path.ts; value = the current (overridden) value. */
    entries: Record<string, unknown>;
    clock?: number;
    reminders?: ScheduledReminder[];
    firedReminders?: FiredReminder[];
};

export const EMPTY_STATE_OVERLAY: StateOverlayFile = { version: 1, entries: {} };
