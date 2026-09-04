import type { Node } from '@xyflow/react';

const ROOT_Y = 0.15;
const SUB_Y = 0.5;
const EXIT_Y = 0.85;
const ROW_SPAN = 0.7; // items in a row are spread across this fraction of width, centered

/**
 * Lays out buildGraphFromLocation()'s output as a hierarchy instead of the
 * free-form draggable/saved positions Map mode uses: root at top, its direct
 * sublocations (parentId === rootId) centered in a row below, and everything
 * else (flat exit-target placeholders) in a further row below that.
 *
 * Positions are normalized fractions (0-1), same convention as Map mode's
 * saved positions - the caller (MapFlow) projects them to on-screen pixels
 * via map-coords.ts's normalizedToPixel(rect, ...), so this stays independent
 * of container size or the background image's aspect ratio.
 *
 * Strips parentId on the returned copies - Map mode's parent-relative
 * positioning must not carry into this absolute layout.
 */
export function layoutAsTree(nodes: Node[], rootId: string): Node[] {
  const root = nodes.find(n => n.id === rootId);
  const subs = nodes.filter(n => n.parentId === rootId);
  const rest = nodes.filter(n => n.id !== rootId && n.parentId !== rootId);

  const centerRow = (items: Node[], y: number) => {
    if (items.length === 0) return [];
    if (items.length === 1) {
      return [{ ...items[0], parentId: undefined, position: { x: 0.5, y } }];
    }
    const step = ROW_SPAN / (items.length - 1);
    const startX = 0.5 - ROW_SPAN / 2;
    return items.map((n, i) => ({
      ...n,
      parentId: undefined,
      position: { x: startX + i * step, y },
    }));
  };

  const laidOut: Node[] = [];
  if (root) laidOut.push({ ...root, parentId: undefined, position: { x: 0.5, y: ROOT_Y } });
  laidOut.push(...centerRow(subs, SUB_Y));
  laidOut.push(...centerRow(rest, EXIT_Y));

  return laidOut;
}
