import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addEdge, Background, BackgroundVariant, Panel, ReactFlow, useEdgesState, useNodesState, useReactFlow, ViewportPortal, type Connection, type Edge, type Node } from '@xyflow/react';
import ZoomInOutlinedIcon from '@mui/icons-material/ZoomInOutlined';
import ZoomOutOutlinedIcon from '@mui/icons-material/ZoomOutOutlined';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';
import { useNavigate } from 'react-router-dom';

import MapNode from '../nodes/MapNode.js';
import { DslContext } from '../contexts/DslContext.js';
import { BackendURL } from '../contexts/BackendContext.js';
import FloatingEdge from '../edges/FloatingEdge.js';
import FloatingConnectionLine from '../edges/FloatingConnectionLine.js';
import { layoutAsTree } from './tree-layout';
import { MapGroupContext, MapViewContext } from './MapViewContext';
import { effectiveNodeScale, settingsToClasses, settingsToCssVars, type MapViewSettings } from './map-view-settings';
import type { MapImage } from './useMapImage';
import { arrowMarkerId, markerColors } from './exit-tags';
import type { MapGraph } from './map-graph';
import { sanitizeLayout } from './map-flow-support';
import { placeNodes, type NormPos } from './auto-layout';
import { fitViewport, mapRectFor, normalizedToPixel, paddedRect, pixelToNormalized, resizedViewport, zoomLimits, type Size, type Viewport } from './map-coords';

// Module-level so ReactFlow doesn't see a new object every render (which would
// remount every node/edge and drop their measured sizes).
const NODE_TYPES = { mapNode: MapNode };
const EDGE_TYPES = { floating: FloatingEdge };
const NODE_ORIGIN: [number, number] = [0.5, 0];
const PRO_OPTIONS = { hideAttribution: true };
const ZOOM_BUTTON_MS = 150;

const mapControlStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0,
  background: 'transparent', border: 'none', color: 'var(--fg-secondary)', cursor: 'pointer',
};

export interface MapFlowProps {
  /** What the saved layout is filed under: a location's name, or `$world`. Nothing loads or saves while it is undefined. */
  scopeKey: string | undefined;
  graph: MapGraph | undefined;
  mode: 'map' | 'tree';
  /** The node the tree view hangs everything from. */
  treeRoot?: string;
  settings: MapViewSettings;
  settingsReady: boolean;
  mapImage: MapImage | null;
  /** Shows a chevron on nodes that have children; it calls this with the node's name. */
  onToggleGroup?: (name: string) => void;
}

const MapFlow = ({ scopeKey, graph, mode, treeRoot, settings, settingsReady, mapImage, onToggleGroup }: MapFlowProps) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { adventure, world } = useContext(DslContext);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  // Saved layout for this scope, normalized fractions, cleared on navigation.
  const [savedLayout, setSavedLayout] = useState<Record<string, NormPos>>({});
  // False until this scope's layout fetch has settled - keeps Map mode from
  // laying nodes out before the saved positions arrive.
  const [layoutReady, setLayoutReady] = useState(false);
  // Live normalized positions (saved layout + any drags this session + the nodes the auto layout placed). The single
  // source of truth Map mode projects from, so a resize / image resolving never loses a drag and never desyncs.
  const positionsRef = useRef<Record<string, NormPos>>({});

  const measured = containerSize.width > 0 && containerSize.height > 0;
  // Map space (see map-coords.ts): a fixed-size rect that every node position is a fraction of.
  // It depends only on the image's aspect, never on the pane, so resizing the pane scales the
  // image and the nodes together instead of re-laying anything out.
  const naturalW = mapImage?.natural.width ?? 0;
  const naturalH = mapImage?.natural.height ?? 0;
  const rect = useMemo(
    () => mapRectFor(naturalW > 0 && naturalH > 0 ? { width: naturalW, height: naturalH } : null),
    [naturalW, naturalH],
  );
  // What the viewport may show: the map plus a margin to pan into. The nodes stay on the map itself.
  const padded = useMemo(() => paddedRect(rect), [rect]);
  const nodeExtent = useMemo<[[number, number], [number, number]]>(
    () => [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]],
    [rect],
  );
  const translateExtent = useMemo<[[number, number], [number, number]]>(
    () => [[padded.x, padded.y], [padded.x + padded.width, padded.y + padded.height]],
    [padded],
  );
  const limits = useMemo(() => zoomLimits(containerSize, padded), [containerSize, padded]);
  const initialViewport = useMemo(() => fitViewport(containerSize, padded), [containerSize, padded]);

  const reactFlow = useReactFlow();
  // Latest viewport, kept from onMove, and the frame it was last fitted for.
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const frameRef = useRef<{ key: string; container: Size; fitZoom: number } | null>(null);
  // True once the user has panned or zoomed. Until then the map re-fits whenever the pane
  // is resized; after, a resize keeps the same map-space centre and zoom relative to the fit.
  const userMovedRef = useRef(false);
  const frameKey = `${scopeKey ?? ''}|${rect.width}x${rect.height}`;

  // The node-size factor is written straight onto the container (not through React state) because in
  // fixed-on-screen mode it follows the zoom, which changes on every wheel tick.
  const settingsRef = useRef(settings);
  const applyNodeScale = useCallback(() => {
    containerRef.current?.style.setProperty(
      '--map-node-scale',
      String(effectiveNodeScale(settingsRef.current.nodes, viewportRef.current.zoom)),
    );
  }, []);
  useEffect(() => {
    settingsRef.current = settings;
    applyNodeScale();
  }, [settings, applyNodeScale]);

  const applyFrame = useCallback((forceFit: boolean) => {
    if (!measured) return;
    const fit = fitViewport(containerSize, padded);
    const last = frameRef.current;
    const sameFrame = last?.key === frameKey;
    if (forceFit || !sameFrame) userMovedRef.current = false;

    const next = userMovedRef.current && last
      ? resizedViewport(viewportRef.current, last.container, last.fitZoom, containerSize, fit.zoom)
      : fit;
    frameRef.current = { key: frameKey, container: containerSize, fitZoom: fit.zoom };
    viewportRef.current = next;
    applyNodeScale();
    void reactFlow.setViewport(next);
  }, [measured, containerSize, padded, frameKey, reactFlow, applyNodeScale]);

  // Re-frame when the pane, the map rect or the scope changes.
  useEffect(() => { applyFrame(false); }, [applyFrame]);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    navigate(`/location/${encodeURIComponent(String(node.data.location))}`);
  }, [navigate]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    positionsRef.current[node.id] = pixelToNormalized(rect, node.position.x, node.position.y);
  }, [rect]);

  // Track the container's rendered size (drives both mapBounds and the image contain-rect).
  // Rounded, and only committed on a real change, so sub-pixel ResizeObserver jitter
  // doesn't keep re-projecting the graph.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const r = container.getBoundingClientRect();
      const width = Math.round(r.width);
      const height = Math.round(r.height);
      setContainerSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Load this scope's saved Map layout once per scope (normalized fractions;
  // legacy pixel entries are dropped). Also resets the live positions.
  useEffect(() => {
    positionsRef.current = {};
    setSavedLayout({});
    setLayoutReady(false);
    if (!scopeKey) return;
    let cancelled = false;
    fetch(`${BackendURL}/file/layout/load?adventure=${adventure}&world=${world}&location=${encodeURIComponent(scopeKey)}`)
      .then(r => r.json())
      .then((saved: Record<string, NormPos>) => {
        if (cancelled) return;
        const clean = sanitizeLayout(saved);
        positionsRef.current = { ...clean };
        setSavedLayout(clean);
      })
      .catch(() => { /* no saved layout - the nodes are placed by the auto layout */ })
      .finally(() => { if (!cancelled) setLayoutReady(true); });
    return () => { cancelled = true; };
  }, [scopeKey, adventure, world]);

  // Build the graph and project every node into map space. Re-runs whenever the graph's content, the view
  // mode, or the map rect changes (an image resolving or being replaced). Nodes that have a position keep it;
  // the rest are placed by the auto layout and remembered, so a later rebuild leaves them where they are.
  // Independent of the pane size: resizing only moves the viewport.
  useEffect(() => {
    if (graph === undefined) return;
    // Map mode needs the saved layout resolved first; tree mode never reads it.
    if (mode === 'map' && !layoutReady) return;

    setEdges(graph.edges);

    let source: Node[];
    if (mode === 'tree') {
      source = layoutAsTree(graph.nodes, treeRoot ?? '');
    } else {
      const known = { ...savedLayout, ...positionsRef.current };
      const near: Record<string, string> = {};
      for (const edge of graph.edges) if (edge.data?.kind === 'sublocation') near[edge.target] = edge.source;
      const placed = placeNodes(
        graph.nodes.map(n => ({ id: n.id, parentId: n.parentId })),
        graph.edges.map(e => ({ source: e.source, target: e.target })),
        known,
        rect,
        near,
      );
      for (const node of graph.nodes) {
        if (!Object.prototype.hasOwnProperty.call(known, node.id)) positionsRef.current[node.id] = placed[node.id];
      }
      source = graph.nodes.map(node => ({ ...node, position: placed[node.id] }));
    }

    setNodes(source.map(node => {
      const p = node.position as NormPos;
      return { ...node, position: normalizedToPixel(rect, p.x, p.y) };
    }));
  }, [graph, treeRoot, mode, layoutReady, savedLayout, rect, setEdges, setNodes]);

  // A user-initiated move arrives with an event; setViewport / zoomIn from here arrive with null.
  const handleMoveStart = useCallback((event: unknown) => {
    if (event) userMovedRef.current = true;
  }, []);
  const handleMove = useCallback((_event: unknown, viewport: Viewport) => {
    viewportRef.current = viewport;
    applyNodeScale();
  }, [applyNodeScale]);
  // ReactFlow has no pan/zoom handle yet when the first frame is applied above, so apply it again once it does.
  const handleInit = useCallback(() => applyFrame(true), [applyFrame]);

  const zoomIn = useCallback(() => { userMovedRef.current = true; void reactFlow.zoomIn({ duration: ZOOM_BUTTON_MS }); }, [reactFlow]);
  const zoomOut = useCallback(() => { userMovedRef.current = true; void reactFlow.zoomOut({ duration: ZOOM_BUTTON_MS }); }, [reactFlow]);
  const fit = useCallback(() => applyFrame(true), [applyFrame]);

  useEffect(() => {
    if (!scopeKey || mode !== 'map') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 's') return;
      e.preventDefault();
      // positionsRef is kept current by onNodeDragStop and the auto layout.
      fetch(`${BackendURL}/file/layout/save?adventure=${adventure}&world=${world}&location=${encodeURIComponent(scopeKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positionsRef.current),
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [scopeKey, adventure, world, mode]);

  return (
    <div
      ref={containerRef}
      className={['w-full h-full overflow-hidden', ...settingsToClasses(settings, mode)].join(' ')}
      style={{
        background: 'var(--bg-editor)', position: 'relative',
        // Hidden until the saved settings arrive, so the map is not drawn in the default colours first.
        visibility: settingsReady ? 'visible' : 'hidden',
        ...settingsToCssVars(settings, mode),
      } as React.CSSProperties}
    >
      {/* The arrowheads exit edges point with: one that follows the exit colour setting, and one per colour a tag rule
          uses. userSpaceOnUse keeps the size the same whatever width a tag rule gives the line. */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {[{ id: 'map-arrow', color: 'var(--map-color-exit, #cccccc)' }, ...markerColors(settings.tagRules).map(hex => ({ id: arrowMarkerId(hex), color: `#${hex}` }))].map(({ id, color }) => (
            <marker
              key={id} id={id} className="react-flow__arrowhead" markerWidth="50" markerHeight="50" viewBox="-10 -10 20 20"
              markerUnits="userSpaceOnUse" orient="auto-start-reverse" refX="0" refY="0"
            >
              <polyline
                style={{ stroke: color, fill: color, strokeWidth: 1 }}
                strokeLinecap="round" strokeLinejoin="round" points="-5,-4 0,0 -5,4 -5,-4"
              />
            </marker>
          ))}
        </defs>
      </svg>
      {measured &&
      (
        <MapViewContext.Provider value={settings}>
        <MapGroupContext.Provider value={onToggleGroup ?? null}>
        <ReactFlow
          // Nodes and Edges
          nodes={nodes}
          edges={edges}
          // Change Handlers
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={onNodeDragStop}
          nodeOrigin={NODE_ORIGIN}
          onMoveStart={handleMoveStart}
          onMove={handleMove}
          onInit={handleInit}
          // Types and Options
          proOptions={PRO_OPTIONS}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          connectionLineComponent={FloatingConnectionLine}
          // Bounds: nodes stay on the map, the view may pan into the padding around it
          translateExtent={translateExtent}
          nodeExtent={nodeExtent}
          // Camera: starts fitted, zooms from the fit of the whole map to MAX_ZOOM_FACTOR times that
          defaultViewport={initialViewport}
          minZoom={limits.minZoom}
          maxZoom={limits.maxZoom}
          // Interaction (a double-click on a node navigates, so it must not also zoom)
          panOnDrag
          selectionOnDrag={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling={true}
          nodesDraggable={mode === 'map'}
          // Styles
        >
          {!mapImage && <Background variant={BackgroundVariant.Dots} color="var(--bd-soft)" gap={16} />}
          {/* Drawn in map space, behind the edges and nodes, so it pans and zooms with them. */}
          <ViewportPortal>
            {mapImage ? (
              <img
                src={mapImage.url}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height,
                  // Tailwind's preflight gives every img max-width: 100%, and the layer this sits in is as wide as the
                  // pane in unscaled pixels, so without this a pane narrower than the map squeezes the image sideways.
                  maxWidth: 'none', maxHeight: 'none',
                  zIndex: -1, pointerEvents: 'none', userSelect: 'none',
                }}
              />
            ) : (
              <div style={{
                position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height,
                zIndex: -1, pointerEvents: 'none', border: '1px dashed var(--bd-soft)',
              }} />
            )}
          </ViewportPortal>
          <Panel position="bottom-right" style={{
            background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', color: 'var(--fg-secondary)',
            padding: '4px 10px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>
            {mode === 'map' ? 'Drag nodes · Scroll to zoom · Ctrl+S to save' : 'Tree layout · read-only'}
          </Panel>
          <Panel position="bottom-left" style={{
            display: 'flex', background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderRadius: 4, overflow: 'hidden',
          }}>
            <button type="button" title="Zoom in" style={mapControlStyle} onClick={zoomIn}><ZoomInOutlinedIcon style={{ fontSize: 16 }} /></button>
            <button type="button" title="Zoom out" style={mapControlStyle} onClick={zoomOut}><ZoomOutOutlinedIcon style={{ fontSize: 16 }} /></button>
            <button type="button" title="Fit the whole map" style={mapControlStyle} onClick={fit}><FitScreenOutlinedIcon style={{ fontSize: 16 }} /></button>
          </Panel>
        </ReactFlow>
        </MapGroupContext.Provider>
        </MapViewContext.Provider>
      )}
    </div>
  );
};

export default MapFlow;
