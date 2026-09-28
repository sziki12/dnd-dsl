import type { PredefinedFunctionSummary } from "../world-state/world-state.service";
import { PREDEFINED_SIGNATURES } from "@dnd-language/evaluation/dnd-dsl-predefined-signatures.js";
import { PREDEFINED_FUNCTIONS } from "@dnd-language/evaluation/dnd-dsl-predefined-functions.js";

/** Implementations, by name. The metadata (params, description, whether a statement-
 *  position call writes back) lives in the canonical PREDEFINED_SIGNATURES so the
 *  language server can validate calls; every signature must have an entry here. */
const IMPLEMENTATIONS: Record<string, (...args: any[]) => any> = {
    ...PREDEFINED_FUNCTIONS,
};

export const predefinedFunctions: PredefinedFunctionSummary[] = PREDEFINED_SIGNATURES.map(sig => {
    const code = IMPLEMENTATIONS[sig.name];
    if (!code) throw new Error(`Predefined function '${sig.name}' has a signature but no implementation`);
    return { ...sig, code };
});

export const predefinedFunctionsAsMap: Record<string, (...args: any[]) => any> = predefinedFunctions.reduce((acc, fn) => {
    acc[fn.name] = fn.code;
    return acc;
}, {} as Record<string, (...args: any[]) => any>);
