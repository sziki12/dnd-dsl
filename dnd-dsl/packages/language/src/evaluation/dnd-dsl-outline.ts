import type { Location, Model } from "../generated/ast.js";

export type OutlineNode = { name: string; file: string; line: number; children: OutlineNode[] };

/**
 * The locations of a world, nested as they are written, each with the file and line it is declared on (`fileAt` turns a
 * line of the glued source into a file and a line in it, see world-files.ts).
 */
export function locationOutline(model: Model, fileAt: (line: number) => { file: string; line: number }): OutlineNode[] {
    const nodeOf = (location: Location): OutlineNode => {
        const at = fileAt((location.$cstNode?.range.start.line ?? 0) + 1);
        return { name: location.name, file: at.file, line: at.line, children: location.sublocations.map(nodeOf) };
    };
    return model.World.locations.map(nodeOf);
}
