import { DefaultLinker, isLinkingError } from "langium";
import type { AstNode, AstNodeDescription, LinkingError, ReferenceInfo } from "langium";
import { isLocation, isObjective } from "./generated/ast.js";
import { childSlot } from "./scope-provider.js";

export class DndLinker extends DefaultLinker
{
    /**
     * A name that is not among the children a step or `entry` may pick says what the children are, instead of the
     * generic "could not resolve": the name is often a real entity, just not this one's child.
     */
    protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription): LinkingError
    {
        const error = super.createLinkingError(refInfo, targetDescription);
        const slot = childSlot(refInfo.container);
        if (!slot) return error;

        const kind = isLocation(slot.owner) ? "location" : "quest";
        const names = slot.children.map(child => child.name);
        const available = names.length > 0 ? `Available: ${names.join(", ")}.` : "It has none.";
        return {
            ...error,
            message: `"${refInfo.reference.$refText}" is not ${/^[aeiou]/.test(slot.noun) ? "an" : "a"} ${slot.noun} of ${kind} "${slot.owner.name}". ${available}`,
        };
    }

    /**
     * Langium links a name that several things share to the first of them, silently. A bare objective name is an error
     * instead when it is not clear which quest's objective is meant, naming the quests and the spelling to use.
     */
    override getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError
    {
        const candidate = super.getCandidate(refInfo);
        if (isLinkingError(candidate)) return candidate;
        return this.ambiguityError(refInfo) ?? candidate;
    }

    private ambiguityError(refInfo: ReferenceInfo): LinkingError | undefined
    {
        // A step, an `entry` or a status form with its quest is scoped to the children of one entity already.
        if (this.reflection.getReferenceType(refInfo) !== "Objective" || childSlot(refInfo.container)) return undefined;

        const name = refInfo.reference.$refText;
        const found = new Set<AstNode>();
        for (const description of this.scopeProvider.getScope(refInfo).getElements(name))
        {
            const node = this.loadAstNode(description);
            if (node) found.add(node);
        }
        // The nearest match comes first. Inside a quest, a bare name means that quest's own objective; only a name that
        // has no match around the reference has to be the only one in the world.
        const [nearest] = found;
        if (!nearest || this.encloses(refInfo.container, nearest)) return undefined;

        // Counted by quest name, which is what the writer can say: the same quest in two open copies of the world is not a doubt.
        const quests = [...new Set([...found].map(node => (isObjective(node) ? node.$container.name : undefined)).filter((quest): quest is string => quest !== undefined))];
        if (quests.length < 2) return undefined;
        return {
            info: refInfo,
            message: `"${name}" is an objective of more than one quest: ${quests.join(", ")}. Write quest "${quests[0]}" -> "${name}" to say which.`,
        };
    }

    /** Whether the container the node sits in (its quest) is around `from`. */
    private encloses(from: AstNode, node: AstNode): boolean
    {
        for (let current: AstNode | undefined = from; current; current = current.$container)
        {
            if (current === node.$container) return true;
        }
        return false;
    }
}
