import { PredefinedFunctionSummary } from "../world-state/world-state.service";

export const predefinedFunctions: PredefinedFunctionSummary[] = [
    {
        name: 'randomfv',
        params: ['min', 'max'],
        description: 'Returns a random integer between min and max (inclusive).',
        code: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    },
];

export const predefinedFunctionsAsMap: Record<string, (...args: any[]) => any> = predefinedFunctions.reduce((acc, fn) => {
    acc[fn.name] = fn.code;
    return acc;
}, {});