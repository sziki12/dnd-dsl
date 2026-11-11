export type OpenFileState = { name: string; dirty: boolean; text: string };
export type DiskFile = { name: string; text: string };

/**
 * What an editor does when another page changed the world's files on disk: take up new files, and re-read a file whose
 * text differs, except one with unsaved edits here (those are kept, and the next save overwrites the disk).
 */
export function planRefresh(open: OpenFileState[], disk: DiskFile[]): { add: DiskFile[]; update: DiskFile[] } {
  const byName = new Map(open.map(file => [file.name, file]));
  const add: DiskFile[] = [];
  const update: DiskFile[] = [];
  for (const file of disk) {
    const current = byName.get(file.name);
    if (!current) add.push(file);
    else if (!current.dirty && current.text !== file.text) update.push(file);
  }
  return { add, update };
}
