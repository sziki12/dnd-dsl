import type { StatePath } from "./dnd-dsl-state-path.js";

// What a bare `party` needs in the backend and in the browser, so only type imports here.

/** The World variable that holds the name of the current party. The `$` keeps it out of reach of any identifier. */
export const CURRENT_PARTY_VARIABLE = "$party.current";

/** The pseudo-member of a bare `party` that reads or sets which party is current: `party . current`. */
export const CURRENT_PARTY_MEMBER = "current";

export const currentPartyPath = (): StatePath => [{ kind: "world" }, { kind: "variable", target: CURRENT_PARTY_VARIABLE }];

/** True for a variable the system added to a world; pages and field listings leave these out. */
export const isHiddenVariable = (target: string | undefined): boolean => target !== undefined && target.startsWith("$");

/** The stored name while a party of that name exists, else the first party (a rename or removal in the source). */
export function resolveCurrentPartyName(partyNames: readonly string[], stored: unknown): string | undefined {
    return typeof stored === "string" && partyNames.includes(stored) ? stored : partyNames[0];
}
