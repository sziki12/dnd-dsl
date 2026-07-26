import type { Node } from '@xyflow/react';

const ROW_H = 140;
const COL_W = 180;

/**
 * Lays out buildGraphFromLocation()'s output as a hierarchy instead of the
 * free-form draggable/saved positions Map mode uses: root at top, its direct
 * sublocations (parentId === rootId) centered in a row below, and everything
 * else (flat exit-target placeholders) in a further row below that.
 *
 * Strips parentId on the returned copies — Map mode's parent-relative
 * positioning must not carry into this absolute layout.
 */
export function layoutAsTree(nodes: Node[], rootId: string): Node[] {
  const root = nodes.find(n => n.id === rootId);
  const subs = nodes.filter(n => n.parentId === rootId);
  const rest = nodes.filter(n => n.id !== rootId && n.parentId !== rootId);

  const centerRow = (items: Node[], y: number) => {
    const width = Math.max(items.length - 1, 0) * COL_W;
    const startX = -width / 2;
    return items.map((n, i) => ({
      ...n,
      parentId: undefined,
      position: { x: startX + i * COL_W, y },
    }));
  };

  const laidOut: Node[] = [];
  if (root) laidOut.push({ ...root, parentId: undefined, position: { x: 0, y: 0 } });
  laidOut.push(...centerRow(subs, ROW_H));
  laidOut.push(...centerRow(rest, ROW_H * 2));

  return laidOut;
}
