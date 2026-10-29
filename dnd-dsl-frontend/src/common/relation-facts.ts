import { membersOf, refName, relationTarget } from '@dnd-language/evaluation/dnd-dsl-relations.js';
import type { StatePath, StatePathSegment } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import type { SerializedModel, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

export type RelationSegment = Extract<StatePathSegment, { kind: 'relation' }>;

/** One relation fact written inside an entity, as a page lists it. */
export type FactView = {
  segment: RelationSegment;
  variables: SerializedVariableDecl[];
};

type Host = { relations?: unknown[] };

/** The facts written in `host` (an npc or faction of the served world), in source order. */
export function factsOf(world: SerializedModel | undefined, host: Host | undefined): FactView[] {
  const facts: FactView[] = [];
  for (const fact of (host?.relations ?? []) as Array<{ predicate?: unknown; variables?: SerializedVariableDecl[] }>) {
    const target = relationTarget(world as never, fact as never);
    const predicate = refName(world as never, fact.predicate as never);
    if (!target || predicate === undefined) continue;
    facts.push({
      segment: { kind: 'relation', predicate, targetKind: target.kind, targetName: target.name },
      variables: fact.variables ?? [],
    });
  }
  return facts;
}

/** Where a fact's variables live: the host's path, then the fact's own segment. */
export function factOwner(host: StatePath, fact: RelationSegment): StatePath {
  return [...host, fact];
}

/** The page a fact's target is shown on. */
export function targetRoute(fact: RelationSegment): string {
  return fact.targetKind === 'faction' ? '/factions' : '/npcs';
}

/** The npcs that are a "Member of" this faction. */
export function membersOfFaction(world: SerializedModel | undefined, faction: string): string[] {
  return world ? membersOf(world as never, faction) : [];
}
