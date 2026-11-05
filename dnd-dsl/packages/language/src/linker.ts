import { DefaultLinker, isLinkingError } from "langium";
import type { AstNode, AstNodeDescription, LinkingError, ReferenceInfo } from "langium";
import { isLocation, isObjective } from "./generated/ast.js";
import { childSlot } from "./scope-provider.js";

/** How a candidate for a bare name is told apart from the others, and how it is written in full. */
interface Candidate
{
    key: string;
    spelling: string;
}

export class DndLinker extends DefaultLinker
{
    /**
     * A name that is not among the children a step or `entry` may pick says what the children are, instead of the
     * generic "could not resolve": the name is often a real entity, just not this one's child.
     */
    protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription): LinkingError
    {
        const error = super.createLinkingError(refInfo, targetDescription);
        const slot = childSlot(refInfo.container, refInfo.property, refInfo.index);
        if (!slot?.owner) return error;

        const kind = isLocation(slot.owner) ? "location" : "quest";
        const names = slot.children.map(child => child.name);
        const available = names.length > 0 ? `Available: ${names.join(", ")}.` : "It has none.";
        return {
            ...error,
            message: `"${refInfo.reference.$refText}" is not ${/^[aeiou]/.test(slot.noun) ? "an" : "a"} ${slot.noun} of ${kind} "${slot.owner.name}". ${available}`,
        };
    }

    /**
     * Langium links a name that several things share to the first of them, silently. A bare objective or location
     * name is an error instead when it is not clear which one is meant, naming them and the spelling to use.
     */
    override getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError
    {
        const candidate = super.getCandidate(refInfo);
        if (isLinkingError(candidate)) return candidate;
        return this.ambiguityError(refInfo) ?? candidate;
    }

    private ambiguityError(refInfo: ReferenceInfo): LinkingError | undefined
    {
        const type = this.reflection.getReferenceType(refInfo);
        if (type !== "Objective" && type !== "Location") return undefined;
        // A step, an `entry`, a status form with its quest or an exit target after its first name is scoped to the
        // children of one entity already; when the name before it did not link there is nothing more to say.
        if (childSlot(refInfo.container, refInfo.property, refInfo.index)) return undefined;

        const name = refInfo.reference.$refText;
        const found = new Set<AstNode>();
        for (const description of this.scopeProvider.getScope(refInfo).getElements(name))
        {
            const node = this.loadAstNode(description);
            if (node) found.add(node);
        }
        // The nearest match comes first. Inside a quest or a location, a bare name means that one's own child; only a
        // name that has no match around the reference has to be the only one in the world.
        const [nearest] = found;
        if (!nearest || this.encloses(refInfo.container, nearest)) return undefined;

        // Counted by what the writer can say, not by node: the same quest or location in two open copies of the world
        // is not a doubt.
        const candidates = new Map<string, Candidate>();
        for (const node of found)
        {
            const candidate = this.describe(node);
            if (candidate && !candidates.has(candidate.key)) candidates.set(candidate.key, candidate);
        }
        if (candidates.size < 2) return undefined;

        const spellings = [...candidates.values()].map(candidate => candidate.spelling);
        return {
            info: refInfo,
            message: type === "Objective"
                ? `"${name}" is an objective of more than one quest: ${[...candidates.values()].map(candidate => candidate.key).join(", ")}. Write ${spellings[0]} to say which.`
                : `"${name}" is the name of more than one location: ${spellings.join(", ")}. Write one of those to say which.`,
        };
    }

    private describe(node: AstNode): Candidate | undefined
    {
        if (isObjective(node))
        {
            return { key: node.$container.name, spelling: `quest "${node.$container.name}" -> "${node.name}"` };
        }
        if (isLocation(node))
        {
            const names: string[] = [];
            for (let current: AstNode | undefined = node; isLocation(current); current = current.$container) names.unshift(current.name);
            return { key: JSON.stringify(names), spelling: `location ${names.map(name => `"${name}"`).join(" -> ")}` };
        }
        return undefined;
    }

    /** Whether the container the node sits in (its quest or parent location) is around `from`. */
    private encloses(from: AstNode, node: AstNode): boolean
    {
        for (let current: AstNode | undefined = from; current; current = current.$container)
        {
            if (current === node.$container) return true;
        }
        return false;
    }
}
