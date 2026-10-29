import type { Model, Npc, Relation } from "../generated/ast.js";
import { serializedRefName } from "./dnd-dsl-reference.js";

/**
 * What kind of entity a relation fact starts from and points at, by AST `$type`. Pure data, so the validator and
 * the evaluators share one table; widening the design later is one row here and one rule alternative.
 * Only type-level imports and the serialized-ref helper, so this is safe in the backend and the browser.
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

export const MEMBER_OF = 'Member of';

/** Either shape a reference takes: a live linked `Reference`, or the `{ $ref, $refText }` of the served JSON. */
type AnyRef = { ref?: { name?: string }; $ref?: string; $refText?: string } | undefined;

type FactHost = { relations?: Relation[] };

/** The name a reference points at, whichever shape it has. `model` is only needed for JSON served without `refText`. */
export function refName(model: Model | undefined, ref: AnyRef): string | undefined {
    if (!ref) return undefined;
    return ref.ref?.name ?? (model ? serializedRefName(model as never, ref as never) : ref.$refText);
}

/** The (kind, name) a fact points at, e.g. `{ kind: 'faction', name: 'Guards' }`. */
export function relationTarget(model: Model | undefined, fact: Relation): { kind: string; name: string } | undefined {
    const kind = ENDPOINT_KIND[fact.target?.$type];
    const name = refName(model, (fact.target as { val?: { val?: AnyRef } } | undefined)?.val?.val);
    return kind && name !== undefined ? { kind, name } : undefined;
}

/** The fact on `host` with this type and target, if it is written there. */
export function findRelation(model: Model | undefined, host: FactHost, predicate: string, targetKind: string, targetName: string): Relation | undefined {
    return host.relations?.find(fact => {
        if (refName(model, fact.predicate) !== predicate) return false;
        const target = relationTarget(model, fact);
        return target?.kind === targetKind && target.name === targetName;
    });
}

/** The names of the factions an npc is a "Member of". */
export function factionsOf(model: Model | undefined, npc: Npc): string[] {
    const names: string[] = [];
    for (const fact of npc.relations ?? []) {
        if (refName(model, fact.predicate) !== MEMBER_OF) continue;
        const target = relationTarget(model, fact);
        if (target?.kind === 'faction') names.push(target.name);
    }
    return names;
}

/** The names of the npcs that are a "Member of" this faction: a scan, there is no reverse index in this slice. */
export function membersOf(model: Model, factionName: string): string[] {
    return model.World.npcs.filter(npc => factionsOf(model, npc).includes(factionName)).map(npc => npc.name);
}
