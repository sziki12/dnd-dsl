/** The path of a folder inside `base`, written with the separator `base` itself uses (a Windows path keeps its backslashes). */
export function joinPath(base: string, name: string): string {
  const separator = base.includes('\\') ? '\\' : '/';
  return base.endsWith(separator) ? `${base}${name}` : `${base}${separator}${name}`;
}
