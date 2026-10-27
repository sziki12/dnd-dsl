/**
 * What kind of entity a relation fact starts from and points at, by AST `$type`. Pure data, so the validator and
 * the evaluators share one table; widening the design later is one row here and one rule alternative.
 */

/** A fact's target: the `$type` of its `RelationEndpoint` -> the kind a relation type lists in `to`. */
export const ENDPOINT_KIND: Readonly<Record<string, string>> = {
    FactionRefItem: 'faction',
    NpcRefItem: 'npc',
};

/** A fact's host: the `$type` of the entity it is written in -> the kind a relation type lists in `from`. */
export const HOST_KIND: Readonly<Record<string, string>> = {
    Faction: 'faction',
    Npc: 'npc',
};
