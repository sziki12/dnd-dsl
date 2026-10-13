// Pure map-space and viewport math for MapFlow - no React/ReactFlow dependency.
//
// The map lives in a fixed coordinate space ("map space"), independent of how big the pane is on
// screen: a rect at the origin whose long side is always MAP_LONG_SIDE units, with the background
// image's aspect (or 3:2 with no image). Every node position is stored/persisted as a normalized
// fraction (0-1) of that rect. The pane only decides the viewport (pan and zoom) that looks at it,
// so resizing the pane scales the whole map - image and nodes - as one.

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; zoom: number };

/** Length of the map rect's longer side, in map units. Keeps node cards a sensible size relative to the map. */
export const MAP_LONG_SIDE = 1200;
/** Aspect (width / height) of the map when there is no background image. */
export const DEFAULT_ASPECT = 3 / 2;
/** Empty space kept around the map when panning, as a fraction of the long side. */
export const MAP_PADDING_RATIO = 0.06;
/** How far in the user can zoom, as a multiple of the zoom that fits the whole map. */
export const MAX_ZOOM_FACTOR = 6;

/** The map rect: at the origin, long side MAP_LONG_SIDE, aspect of the image (or the default). */
export function mapRectFor(natural: Size | null): Rect {
  const aspect = natural && natural.width > 0 && natural.height > 0 ? natural.width / natural.height : DEFAULT_ASPECT;
  return aspect >= 1
    ? { x: 0, y: 0, width: MAP_LONG_SIDE, height: MAP_LONG_SIDE / aspect }
    : { x: 0, y: 0, width: MAP_LONG_SIDE * aspect, height: MAP_LONG_SIDE };
}

/** The rect grown by the pan padding on every side - what the viewport may show. */
export function paddedRect(rect: Rect, ratio: number = MAP_PADDING_RATIO): Rect {
  const pad = ratio * Math.max(rect.width, rect.height);
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad };
}

/** Zoom at which `rect` just fits in `container`. */
function fitZoom(container: Size, rect: Rect): number {
  return Math.min(container.width / rect.width, container.height / rect.height);
}

/** The viewport that shows `rect` completely, centered in `container`. */
export function fitViewport(container: Size, rect: Rect): Viewport {
  if (container.width <= 0 || container.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const zoom = fitZoom(container, rect);
  return {
    x: container.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: container.height / 2 - (rect.y + rect.height / 2) * zoom,
    zoom,
  };
}

/** Zoom limits for a container: out to the zoom that fits the padded map, in to MAX_ZOOM_FACTOR times that. */
export function zoomLimits(container: Size, padded: Rect): { minZoom: number; maxZoom: number } {
  const min = fitViewport(container, padded).zoom;
  return { minZoom: min, maxZoom: min * MAX_ZOOM_FACTOR };
}

/** The map-space point at the middle of the container. */
export function viewportCenter(viewport: Viewport, container: Size): Point {
  return {
    x: (container.width / 2 - viewport.x) / viewport.zoom,
    y: (container.height / 2 - viewport.y) / viewport.zoom,
  };
}

/** The viewport that puts map-space point `center` at the middle of the container. */
export function viewportFromCenter(center: Point, zoom: number, container: Size): Viewport {
  return { x: container.width / 2 - center.x * zoom, y: container.height / 2 - center.y * zoom, zoom };
}

/**
 * The viewport after the container is resized while the user has moved the view: the same map-space
 * centre, and the same zoom relative to the fit (so "twice as close as fitted" stays that way).
 */
export function resizedViewport(
  previous: Viewport,
  previousContainer: Size,
  previousFitZoom: number,
  next: Size,
  nextFitZoom: number,
): Viewport {
  if (previousFitZoom <= 0 || nextFitZoom <= 0 || next.width <= 0 || next.height <= 0) {
    return { x: 0, y: 0, zoom: nextFitZoom > 0 ? nextFitZoom : 1 };
  }
  const relative = Math.min(Math.max(previous.zoom / previousFitZoom, 1), MAX_ZOOM_FACTOR);
  return viewportFromCenter(viewportCenter(previous, previousContainer), relative * nextFitZoom, next);
}

export function normalizedToPixel(rect: Rect, nx: number, ny: number): Point {
  return { x: rect.x + nx * rect.width, y: rect.y + ny * rect.height };
}

export function pixelToNormalized(rect: Rect, px: number, py: number): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: (px - rect.x) / rect.width, y: (py - rect.y) / rect.height };
}
