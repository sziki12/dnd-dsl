import { useCallback, useMemo, useState, useRef, useEffect, useContext } from 'react';

import { addEdge, Background, BackgroundVariant, MarkerType, Panel, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, ViewportPortal, type Connection, type Edge, type Node } from '@xyflow/react';
import { evaluateExpression, inferKind, isObjectResult, type SerialisedObjectDeclaration } from '../common/expression-evaluator';
import { renderValueToken } from '../common/ValueToken';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ZoomInOutlinedIcon from '@mui/icons-material/ZoomInOutlined';
import ZoomOutOutlinedIcon from '@mui/icons-material/ZoomOutOutlined';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';

import MapNode from '../nodes/MapNode.js';
import { useNavigate, useParams } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext.js';
import { BackendURL } from '../contexts/BackendContext.js';
import FloatingEdge from '../edges/FloatingEdge.js';
import FloatingConnectionLine from '../edges/FloatingConnectionLine.js';
import type { SerializedModel, SerializedLocation, SerializedVariableDecl, SerializedAstNode, SerializedRef } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { findLocation } from '../common/location-tree';
import EnumValueSelect from '../common/EnumValueSelect';
import { layoutAsTree } from './tree-layout';
import { fitViewport, mapRectFor, normalizedToPixel, paddedRect, pixelToNormalized, resizedViewport, zoomLimits, type Size, type Viewport } from './map-coords';

const LocationView = () => {
  let {locationName} = useParams()
  let {worldState} = useContext(DslContext)

  let [locationData, setLocationData] = useState<SerializedLocation | undefined>(undefined)
  const [leftTab, setLeftTab] = useState<'variables' | 'npcs'>('variables')
  const [viewMode, setViewMode] = useState<'map' | 'tree'>('map')

  // What the doc panel below the tree currently shows - `path` is a dot-joined name
  // path (unique across nesting depth, stable across worldState updates, since it's
  // built from declaration names rather than object identity) used only to detect
  // "is this the same row clicked again"; `decl` is what the panel displays.
  type DocTarget = Pick<SerializedVariableDecl, 'target' | 'isComputed'>
  const [selectedVariable, setSelectedVariable] = useState<{ path: string; decl: DocTarget } | null>(null)

  // Clicking an already-selected row deselects it instead of re-selecting it.
  const toggleSelected = (path: string, decl: DocTarget) => {
    setSelectedVariable(prev => (prev?.path === path ? null : { path, decl }))
  }

  const renderObjectProps = (obj: SerialisedObjectDeclaration, parentPath: string) => (
    <div style={{ marginLeft: 16, marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
      {Object.entries(obj.staticProperties).map(([propName, propValue]) => {
        const path = `${parentPath}.${propName}`
        const isSelected = selectedVariable?.path === path
        const decl: DocTarget = { target: propName, isComputed: undefined }
        return isObjectResult(propValue) ? (
          <div key={propName}>
            <div className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, decl)}>
              <span className="tok-keyword">object</span>
              <span className="tok-variable">{propName}</span>
            </div>
            {renderObjectProps(propValue, path)}
          </div>
        ) : (
          <div key={propName} className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, decl)}>
            <span className="tok-variable">{propName}</span>
            <span className="tok-operator">=</span>
            {renderValueToken(propValue)}
          </div>
        )
      })}
      {obj.computedPropertyDecls.map((propDecl) => {
        const propValue = evaluateExpression(propDecl.value, { variableName: propDecl.target, worldState })
        const path = `${parentPath}.${propDecl.target}`
        const isSelected = selectedVariable?.path === path
        return isObjectResult(propValue) ? (
          <div key={propDecl.target}>
            <div className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, propDecl)}>
              <span className="tok-comment">computed</span>
              <span className="tok-variable">{propDecl.target}</span>
            </div>
            {renderObjectProps(propValue, path)}
          </div>
        ) : (
          <div key={propDecl.target} className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, propDecl)}>
            <span className="tok-comment">computed</span>
            <span className="tok-variable">{propDecl.target}</span>
            <span className="tok-operator">=</span>
            {renderValueToken(propValue)}
          </div>
        )
      })}
    </div>
  )

  useEffect(()=>{

    const newLocation = getLocationData(worldState, locationName ?? "Location")
    if(typeof(newLocation) == "undefined")
      return
    setLocationData(newLocation)
    setSelectedVariable(null)
    console.log(`Loaded location data for ${locationName}:`, newLocation)
  },[worldState, locationName])

  return (
    <div className="h-full w-full flex flex-col lg:flex-row" style={{ background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      {/* Left pane: Variables / NPCs */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ borderRight: '1px solid var(--bd-divider)', minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className={"pane-tab " + (leftTab === 'variables' ? 'active' : '')} onClick={() => setLeftTab('variables')}>
              <CodeOutlinedIcon style={{ fontSize: 13 }} /> Variables
              <span className="cnt">{locationData?.variables.length ?? 0}</span>
            </button>
            <button className={"pane-tab " + (leftTab === 'npcs' ? 'active' : '')} onClick={() => setLeftTab('npcs')}>
              <PersonOutlineIcon style={{ fontSize: 13 }} /> NPCs
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {leftTab === 'variables' ? (
            <>
              <div className="var-banner">
                <h1>{locationName}</h1>
              </div>
              <div style={{ padding: '8px 0' }}>
                {locationData?.variables.map((variable: SerializedVariableDecl, i: number) => {
                  const isComputed = variable.isComputed === 'computed'
                  const path = variable.target ?? ''
                  const isSelected = selectedVariable?.path === path

                  if (isComputed) {
                    // Live view of the current value - re-evaluated on every render, so it
                    // reflects any worldState change (local command or another page's, via
                    // DslContext.applyCommandResponse / the /state-sync broadcast).
                    const value = evaluateExpression(variable.value, { variableName: variable.target, worldState })
                    const valueObj = isObjectResult(value) ? value : undefined

                    return (
                      <div key={variable.target}>
                        <div
                          className={"var-row " + (isSelected ? 'selected' : '')}
                          onClick={() => toggleSelected(path, variable)}
                        >
                          <div className="gutter">{i + 1}</div>
                          <div className="declaration">
                            <span className="tok-comment">computed</span>
                            <span className="tok-variable">{variable.target}</span>
                            {!valueObj && (
                              <>
                                <span className="tok-operator">=</span>
                                {renderValueToken(value)}
                              </>
                            )}
                          </div>
                        </div>
                        {valueObj && renderObjectProps(valueObj, path)}
                      </div>
                    )
                  }

                  const value = evaluateExpression(variable.value, { variableName: variable.target, worldState })
                  if (isObjectResult(value)) {
                    const obj = value as SerialisedObjectDeclaration
                    return (
                      <div key={variable.target}>
                        <div
                          className={"var-row " + (isSelected ? 'selected' : '')}
                          onClick={() => toggleSelected(path, variable)}
                        >
                          <div className="gutter">{i + 1}</div>
                          <div className="declaration">
                            <span className="tok-keyword">object</span>
                            <span className="tok-variable">{variable.target}</span>
                          </div>
                        </div>
                        {renderObjectProps(obj, path)}
                      </div>
                    )
                  }

                  const kind = inferKind(value)
                  return (
                    <div
                      key={variable.target}
                      className={"var-row " + (isSelected ? 'selected' : '')}
                      onClick={() => toggleSelected(path, variable)}
                    >
                      <div className="gutter">{i + 1}</div>
                      <div className="declaration">
                        <span className="tok-keyword">{kind === 'unknown' ? 'let' : kind}</span>
                        <span className="tok-variable">{variable.target}</span>
                        <span className="tok-operator">=</span>
                        {renderValueToken(value)}
                        {locationData && (
                          <EnumValueSelect
                            variable={variable}
                            owner={{ kind: 'location', name: locationData.name }}
                            currentValue={value}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {selectedVariable && (
                <div className="var-doc">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="tok-type">{selectedVariable.decl.isComputed === 'computed' ? 'computed' : 'let'}</span>
                    <span className="tok-variable">{selectedVariable.decl.target}</span>
                  </div>
                  <div className="meta">
                    <span><strong>computed:</strong> {selectedVariable.decl.isComputed === 'computed' ? 'yes' : 'no'}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="npc-stub">
              No NPC data available - not supported by the current DSL grammar yet.
            </div>
          )}
        </div>
      </div>

      {/* Right pane: Map / Tree */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className={"pane-tab " + (viewMode === 'map' ? 'active' : '')} onClick={() => setViewMode('map')}>
              <RoomOutlinedIcon style={{ fontSize: 13 }} /> Map
            </button>
            <button className={"pane-tab " + (viewMode === 'tree' ? 'active' : '')} onClick={() => setViewMode('tree')}>
              <AccountTreeOutlinedIcon style={{ fontSize: 13 }} /> Tree
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <ReactFlowProvider>
            <MapFlow location={locationData} mode={viewMode} />
          </ReactFlowProvider>
        </div>
      </div>

    </div>
  );
};

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

type NormPos = { x: number; y: number };

/**
 * Keeps only normalized-fraction entries from a saved layout file. Older saves
 * wrote raw container pixels (values in the hundreds, sometimes negative); fed
 * through normalizedToPixel those land thousands of pixels off-canvas, so drop
 * them and let the node fall back to its default position.
 */
function sanitizeLayout(raw: Record<string, NormPos> | null | undefined): Record<string, NormPos> {
  const out: Record<string, NormPos> = {};
  for (const [id, p] of Object.entries(raw ?? {})) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.5 && p.x <= 1.5 && p.y >= -0.5 && p.y <= 1.5) {
      out[id] = { x: p.x, y: p.y };
    }
  }
  return out;
}

const MapFlow = ({location, mode}: { location: SerializedLocation | undefined, mode: 'map' | 'tree' }) => {
const navigate = useNavigate();
const containerRef = useRef<HTMLDivElement>(null);
let { getByReference, adventure, world } = useContext(DslContext)
const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
const [mapImage, setMapImage] = useState<{ url: string; natural: Size } | null>(null);
  // Saved layout for this location, normalized fractions, cleared on navigation.
  const [savedLayout, setSavedLayout] = useState<Record<string, NormPos>>({});
  // False until this location's layout fetch has settled - keeps Map mode from
  // flashing the fallback spread before the saved positions arrive.
  const [layoutReady, setLayoutReady] = useState(false);
  // Live normalized positions (saved layout + any drags this session). The single
  // source of truth Map mode projects from, so a resize / image resolving never
  // loses a drag and never desyncs.
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
  const frameKey = `${location?.name ?? ''}|${rect.width}x${rect.height}`;

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
    void reactFlow.setViewport(next);
  }, [measured, containerSize, padded, frameKey, reactFlow]);

  // Re-frame when the pane, the map rect or the location changes.
  useEffect(() => { applyFrame(false); }, [applyFrame]);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    navigate(`/location/${node.data.location}`);
  }, [navigate]);

  // Edge click handler to toggle direction
  /*const onEdgeClick = useCallback((_event: React.MouseEvent, clickedEdge: any) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === clickedEdge.id) {
          const currentDir = edge.data?.direction || 'both';
          
          // Cycle: end -> start -> both
          const directionOrder = ['end', 'start', 'both'];
          const currentIndex = directionOrder.indexOf(currentDir as string);
          const nextDir = directionOrder[(currentIndex + 1) % 3];
          var markerEnd: any | undefined = undefined;
          var markerStart: any | undefined = undefined;
         
          switch(nextDir) {
            case 'start':
              markerStart = {
                type: MarkerType.ArrowClosed,
                width: targetSize,
                height: targetSize,
                color: markerColor,
              };
              markerEnd = undefined;
              break;
            case 'end':
              markerStart = undefined;
              markerEnd = {
                type: MarkerType.ArrowClosed,
                width: targetSize,
                height: targetSize,
                color: markerColor,
              };
              break;
            case 'both':
              markerStart = {
                type: MarkerType.ArrowClosed,
                width: targetSize,
                height: targetSize,
                color: markerColor,
              };
              markerEnd = {
                type: MarkerType.ArrowClosed,
                width: targetSize,
                height: targetSize,
                color: markerColor,
              };
              break;
          }

          console.log(`Edge ${edge.id} direction changed from ${currentDir} to ${nextDir}`);

          return {
            ...edge,
            data: { ...edge.data, direction: nextDir },
            markerStart,
            markerEnd
          } as typeof edge;
        }
        return edge;
      })
    );
  }, [setEdges]);*/

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

  // Resolve this location's map image (if any). Falls back to no image (dot-grid
  // background) on any failure - a location without a Maps.json entry is the
  // normal case today, not an error state the user should see.
  useEffect(() => {
    // Clear immediately so a location without a map does not inherit the previous
    // location's letterbox rect while its 404 is in flight.
    setMapImage(null);
    if (!location) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    fetch(`${BackendURL}/image/load?adventure=${adventure}&location=${encodeURIComponent(location.name)}`)
      .then(res => { if (!res.ok) throw new Error('no map image'); return res.blob(); })
      .then(blob => new Promise<{ url: string; natural: Size }>((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ url, natural: { width: img.naturalWidth, height: img.naturalHeight } });
        img.onerror = () => reject(new Error('failed to decode map image'));
        img.src = url;
      }))
      .then(result => {
        if (cancelled) { URL.revokeObjectURL(result.url); return; }
        objectUrl = result.url;
        setMapImage(result);
      })
      .catch(() => { if (!cancelled) setMapImage(null); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [location?.name, adventure]);

  // Load this location's saved Map layout once per location (normalized fractions;
  // legacy pixel entries are dropped). Also resets the live positions.
  useEffect(() => {
    positionsRef.current = {};
    setSavedLayout({});
    setLayoutReady(false);
    if (!location) return;
    let cancelled = false;
    fetch(`${BackendURL}/file/layout/load?adventure=${adventure}&world=${world}&location=${encodeURIComponent(location.name)}`)
      .then(r => r.json())
      .then((saved: Record<string, NormPos>) => {
        if (cancelled) return;
        const clean = sanitizeLayout(saved);
        positionsRef.current = { ...clean };
        setSavedLayout(clean);
      })
      .catch(() => { /* no saved layout - nodes use their default positions */ })
      .finally(() => { if (!cancelled) setLayoutReady(true); });
    return () => { cancelled = true; };
  }, [location?.name, adventure, world]);

  // Build the graph and project every node into map space. Re-runs whenever the source, the
  // view mode, or the map rect changes (an image resolving or being replaced) - projecting
  // fresh from normalized positions each time (no lossy round-trip). Independent of the pane
  // size: resizing only moves the viewport.
  useEffect(() => {
    if (typeof location == "undefined") return;
    // Map mode needs the saved layout resolved first; tree mode never reads it.
    if (mode === 'map' && !layoutReady) return;

    const graph = buildGraphFromLocation(location, getByReference) || buildDefaultGraph();
    setEdges(graph.edges);

    // Tree mode: absolute hierarchy from layoutAsTree, which also strips parentId
    // (Map mode's parent-relative positioning must not carry into this layout).
    const source = mode === 'tree'
      ? layoutAsTree(graph.nodes, location.name)
      : graph.nodes.map(node => ({
          ...node,
          position: positionsRef.current[node.id] ?? savedLayout[node.id] ?? (node.position as NormPos),
        }));

    setNodes(source.map(node => {
      const p = node.position as NormPos;
      return { ...node, position: normalizedToPixel(rect, p.x, p.y) };
    }));
  }, [location?.name, mode, layoutReady, savedLayout, rect.x, rect.y, rect.width, rect.height]);

  // A user-initiated move arrives with an event; setViewport / zoomIn from here arrive with null.
  const handleMoveStart = useCallback((event: unknown) => {
    if (event) userMovedRef.current = true;
  }, []);
  const handleMove = useCallback((_event: unknown, viewport: Viewport) => {
    viewportRef.current = viewport;
  }, []);
  // ReactFlow has no pan/zoom handle yet when the first frame is applied above, so apply it again once it does.
  const handleInit = useCallback(() => applyFrame(true), [applyFrame]);

  const zoomIn = useCallback(() => { userMovedRef.current = true; void reactFlow.zoomIn({ duration: ZOOM_BUTTON_MS }); }, [reactFlow]);
  const zoomOut = useCallback(() => { userMovedRef.current = true; void reactFlow.zoomOut({ duration: ZOOM_BUTTON_MS }); }, [reactFlow]);
  const fit = useCallback(() => applyFrame(true), [applyFrame]);

  useEffect(() => {
    if (typeof location == "undefined" || mode !== 'map') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 's') return;
      e.preventDefault();
      // positionsRef is kept current by onNodeDragStop.
      fetch(`${BackendURL}/file/layout/save?adventure=${adventure}&world=${world}&location=${encodeURIComponent(location!.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positionsRef.current),
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [location?.name, adventure, world, mode]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" style={{ background: 'var(--bg-editor)', position: 'relative' }}>
      {measured &&
      (
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
          <Panel position="top-right" style={{
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
      )}
    </div>
  );
};

function buildGraphFromLocation(location: SerializedLocation, getByReference: <T extends SerializedAstNode>(ref: SerializedRef | undefined) => T | undefined) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const knownIds = new Set(location.sublocations.map(s => s.name));

  const targetSize = 50;

  const lineColor = '#9d9d9d'; // mirrors --fg-secondary - exit edges
  const markerColor = '#cccccc'; // mirrors --fg-primary - exit edge arrowheads
  //Create current location node
  nodes.push({
          id: location.name,
          type: 'mapNode',
          position: { x: 0, y: 0 },
          data: {
            location: location.name,
            type: 'group',
          },
        });

  for (const exit of location.exits ?? []) {
    console.log(`exit.exit?.$ref ${exit.exit?.$ref}`);
    const targetName = getByReference<SerializedLocation>(exit.exit)?.name ?? 'Unknown';
    console.log(`Processing exit ${exit.name} from ${location.name} to target ${targetName}`);
    // Add external target
    if (!knownIds.has(targetName)) {
      knownIds.add(targetName);
      nodes.push({
        id: targetName,
        type: 'mapNode',
        position: { x: 0, y: 0 },
        data: {
          location: targetName,
        },
      });
    }
    edges.push({
        id: `${location.name}->${targetName}-${exit.name}`,
        source: location.name,
        target: targetName,
        label: exit.name,
        type: 'floating',
        data: { identifiers: exit.identifiers },
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          width: targetSize,
          height: targetSize,
          color: markerColor, 
        },
        style: {
        strokeWidth: 1,
        stroke: lineColor,
        },
      });
  }

  for (const sub of location.sublocations) {
    nodes.push({
      id: sub.name,
      type: 'mapNode',
      position: { x: 0, y: 0 },
      data: {
        location: sub.name,
        isEntry: getByReference<SerializedLocation>(location.entry?.entry)?.name === sub.name,
      },
      parentId: location.name,
    });
    edges.push({
      id: `${location.name}->${sub.name}-sublocation`,
      source: location.name,
      target: sub.name,
      type: 'floating',
      style: {
        strokeWidth: 1,
        stroke: '#4ec9b0', // mirrors --syn-type - sublocation edges
        strokeDasharray: '5 5', // Dashed line for sublocation edges
      },
    });

    for (const exit of sub.exits ?? []) {
      console.log(`sub -> exit.exit?.$ref ${exit.exit?.$ref}`);
      const targetName = getByReference<SerializedLocation>(exit.exit)?.name ?? 'Unknown';
      console.log(`Processing exit ${exit.name} from ${sub.name} to target ${targetName}`);
      // Add placeholder node for external targets
      if (!knownIds.has(targetName)) {
        knownIds.add(targetName);
        nodes.push({
          id: targetName,
          type: 'mapNode',
          position: { x: 0, y: 0 },
          data: {
            location: targetName,
            isEntry: getByReference<SerializedLocation>(location.entry?.entry)?.name === targetName,
          },
        });
      }

      edges.push({
        id: `${sub.name}->${targetName}-${exit.name}`,
        source: sub.name,
        target: targetName,
        label: exit.name,
        type: 'floating',
        data: { identifiers: exit.identifiers },
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          width: targetSize, 
          height: targetSize, 
          color: markerColor
        },
        style: {
        strokeWidth: 1,
        stroke: lineColor,
        },
      });
    }
  }
  console.log(location);
  console.log(`Processed location ${location.name} with ${location.sublocations.length} sublocations`);
  console.log(`Built graph with ${nodes.length} nodes and ${edges.length} edges from location ${location.name}`);
  return { nodes, edges };
}

function buildDefaultGraph() {
  const defaultNodes: Node<{ location: string }>[] = [
    { id: 'n1', position: { x: 50, y: 50 }, data: { location: 'Place 1' }, type: 'mapNode' },
    { id: 'n2', position: { x: 100, y: 100 }, data: { location: 'Place 2' }, type: 'mapNode' },
  ];
const defaultEdges = [{
    id: 'n1-n2',
    source: 'n1',
    target: 'n2',
    label: 'Transition Name',
    data: { direction: 'both' },
    type: 'floating',
    markerStart: {
      type: MarkerType.ArrowClosed,
      //width: targetSize,
      //height: targetSize,
      //color: markerColor,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      //width: targetSize,
      //height: targetSize,
      //color: markerColor,
    },
  }];

  return { nodes: defaultNodes, edges: defaultEdges };
}

const getLocationData = (worldState: SerializedModel | undefined, locationName: string) => {
  if (worldState?.World == undefined) return undefined;
  return findLocation(worldState.World.locations, locationName);
}

export default LocationView;