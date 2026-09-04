// Pure coordinate math for MapFlow - no React/ReactFlow dependency.
//
// Every node position is stored/persisted as a normalized fraction (0-1) of a
// "map rect", not a raw container pixel. The rect is either the background
// image's letterboxed contain-rect, or (when there's no image) the full
// container - so callers always convert through the same rect regardless of
// whether an image is present.

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** object-fit: contain letterbox math. Falls back to the full container when there's no image. */
export function computeContainRect(container: Size, natural: Size | null): Rect {
  if (!natural || natural.width <= 0 || natural.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }

  const containerRatio = container.width / container.height;
  const imageRatio = natural.width / natural.height;

  let width: number;
  let height: number;
  if (imageRatio > containerRatio) {
    width = container.width;
    height = width / imageRatio;
  } else {
    height = container.height;
    width = height * imageRatio;
  }

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

export function normalizedToPixel(rect: Rect, nx: number, ny: number): { x: number; y: number } {
  return { x: rect.x + nx * rect.width, y: rect.y + ny * rect.height };
}

export function pixelToNormalized(rect: Rect, px: number, py: number): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: (px - rect.x) / rect.width, y: (py - rect.y) / rect.height };
}
