/** A path segment (adventure or world name) that cannot leave its folder. */
export function isSafeSegment(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[\\/\0]/.test(value);
}
