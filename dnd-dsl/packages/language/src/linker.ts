import { DefaultLinker } from "langium";
import type { AstNodeDescription, LinkingError, ReferenceInfo } from "langium";
import { isLocation } from "./generated/ast.js";
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
}
