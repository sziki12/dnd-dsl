import { useState } from 'react';

/** Which way dragging the handle grows the pane - 'up'/'left' mean the handle sits
 *  on the pane's top/left edge, so dragging toward that edge grows it (a bottom
 *  panel resized from its top edge, e.g.); 'down'/'right' mean the opposite (a
 *  right sidebar resized from its left edge still drags "left to grow", which is
 *  'left' here - the direction names the edge the handle is on, not the pane). */
export type ResizeDirection = 'up' | 'down' | 'left' | 'right';

function readStoredSize(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSize(storageKey: string, size: number): void {
  try {
    localStorage.setItem(storageKey, String(size));
  } catch {
    // localStorage unavailable - the size just won't persist across reloads.
  }
}

/**
 * A draggable pane size backed by localStorage, for a panel resized by dragging one
 * of its edges (an editor/output split, a sidebar). Returns the current size and a
 * `onMouseDown` handler to put on the drag handle; the size is written to
 * localStorage once, on mouseup, not on every mousemove.
 */
export function useResizablePane(
  storageKey: string,
  defaultSize: number,
  { min, max = Infinity, direction }: { min: number; max?: number; direction: ResizeDirection },
): [size: number, onHandleMouseDown: (e: React.MouseEvent) => void] {
  const [size, setSize] = useState(() => readStoredSize(storageKey, defaultSize));

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const axis = direction === 'up' || direction === 'down' ? 'clientY' : 'clientX';
    const grows = direction === 'up' || direction === 'left' ? -1 : 1;
    const startPos = e[axis];
    const startSize = size;
    let latest = startSize;

    const onMove = (ev: MouseEvent) => {
      latest = Math.min(max, Math.max(min, startSize + (ev[axis] - startPos) * grows));
      setSize(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      writeStoredSize(storageKey, latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return [size, onHandleMouseDown];
}
