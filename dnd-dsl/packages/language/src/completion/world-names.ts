import type { AstNode, AstNodeDescription, AstNodeLocator, IndexManager, LangiumDocument, LangiumDocuments } from "langium";
import { isLocation, isWorld, type Location } from "../generated/ast.js";
import { ObjectKind } from "../dnd-dsl-validator.js";
import { visibleFrom, worldNameOf } from "../world-scope.js";
import type { NameEntry } from "./quoted-names.js";

/** The entities the index holds for the world a document is written for, and what tells two of the same name apart. */
export class WorldNames {
    constructor(
        private readonly indexManager: IndexManager,
        private readonly documents: LangiumDocuments,
        private readonly locator: AstNodeLocator,
    ) {}

    /** What the index holds of one kind that the world `document` is written for can see (see world-scope.ts). */
    worldElements(type: string, document: LangiumDocument): AstNodeDescription[] {
        const world = worldNameOf(document.parseResult.value);
        return Array.from(this.indexManager.allElements(type)).filter(description => visibleFrom(world, description, this.documents));
    }

    nodeOf(description: AstNodeDescription): AstNode | undefined {
        if (description.node) return description.node;
        const target = this.documents.hasDocument(description.documentUri) ? this.documents.getDocument(description.documentUri) : undefined;
        return target ? this.locator.getAstNode(target.parseResult.value, description.path) : undefined;
    }

    findByName(type: ObjectKind, name: string, document: LangiumDocument): AstNode | undefined {
        let first: AstNode | undefined;
        for (const description of this.worldElements(type, document)) {
            if (description.name !== name) continue;
            const node = this.nodeOf(description);
            // A top-level location is where a path starts; a sublocation of the same name is reached through its parent.
            if (!isLocation(node) || !isLocation(node.$container)) return node;
            first ??= node;
        }
        return first;
    }

    /**
     * The names of every entity of a kind. Objectives of different quests and locations under different parents may
     * share a name; the quest or parent in the detail keeps those entries apart.
     */
    nameEntries(typeName: string, document: LangiumDocument): NameEntry[] {
        const { found, shared } = this.ownersByName(typeName, document);
        return found.map(({ description, owner }) =>
            shared.has(description.name) && owner.detail ? { name: description.name, detail: owner.detail } : description.name);
    }

    /** What tells this entity from another of the same name (its quest or parent locations); undefined while the name is its alone. */
    sharedDetail(description: AstNodeDescription, document: LangiumDocument): string | undefined {
        return this.ownersByName(description.type, document).shared.has(description.name)
            ? this.ownerOf(description.type, this.nodeOf(description)).detail
            : undefined;
    }

    /**
     * The first name of an exit target as the linker would find it: among the sublocations of the location the exit is in,
     * then among its siblings, then the siblings of its parent and so on up; else any location of that name.
     */
    nearestLocation(name: string, owner: Location | undefined, document: LangiumDocument): Location | undefined {
        const levels: Location[][] = owner ? [owner.sublocations] : [];
        for (let place: AstNode | undefined = owner; place; place = place.$container) {
            if (!isLocation(place)) continue;
            const parent = place.$container;
            levels.push(isLocation(parent) ? parent.sublocations : isWorld(parent) ? parent.locations : []);
        }
        for (const level of levels) {
            const hit = level.find(location => location.name === name);
            if (hit) return hit;
        }
        return this.findByName(ObjectKind.Location, name, document) as Location | undefined;
    }

    /** The entities of a kind with their owners, and the names more than one owner uses. Counted by owner, not by index entry: the same world open twice is not a shared name. */
    private ownersByName(typeName: string, document: LangiumDocument): { found: Array<{ description: AstNodeDescription; owner: { key: string; detail?: string } }>; shared: Set<string> } {
        const found = Array.from(this.worldElements(typeName, document), description => ({ description, owner: this.ownerOf(typeName, this.nodeOf(description)) }));
        const owners = new Map<string, Set<string>>();
        for (const { description, owner } of found) owners.set(description.name, (owners.get(description.name) ?? new Set<string>()).add(owner.key));
        return { found, shared: new Set(Array.from(owners).filter(([, keys]) => keys.size > 1).map(([name]) => name)) };
    }

    /** What tells apart two entities of a name: the quest of an objective, the parent locations of a location. */
    private ownerOf(typeName: string, node: AstNode | undefined): { key: string; detail?: string } {
        if (typeName === ObjectKind.Objective && node?.$container && "name" in node.$container) {
            const quest = String(node.$container.name);
            return { key: quest, detail: `${typeName} of ${quest}` };
        }
        if (typeName === ObjectKind.Location && node) {
            const parents: string[] = [];
            for (let parent: AstNode | undefined = node.$container; isLocation(parent); parent = parent.$container) parents.unshift(parent.name);
            return { key: JSON.stringify(parents), detail: parents.length > 0 ? `${typeName} in ${parents.join(" -> ")}` : undefined };
        }
        return { key: "" };
    }
}
