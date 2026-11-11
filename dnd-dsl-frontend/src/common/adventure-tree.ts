// The Editor holds the files of every world of an adventure. A file is told by its world and its name.

export type FileRef = { world: string; name: string };

/** One string for a file; neither a world nor a file name can contain a slash. */
export const fileKey = (world: string, name: string): string => `${world}/${name}`;

export function splitKey(key: string): FileRef {
  const at = key.indexOf('/');
  return { world: key.slice(0, at), name: key.slice(at + 1) };
}

/** The file the Editor shows when nothing is chosen: the first of the open world, else the first of all. */
export function firstFile(files: readonly FileRef[], activeWorld: string): FileRef | undefined {
  const byName = (a: FileRef, b: FileRef) => a.name.localeCompare(b.name);
  const own = files.filter(file => file.world === activeWorld).sort(byName);
  return own[0] ?? [...files].sort((a, b) => a.world.localeCompare(b.world) || byName(a, b))[0];
}
