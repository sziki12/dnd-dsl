import { useCallback, useState, useRef, useEffect, useContext } from 'react';

import { addEdge, Background, BackgroundVariant, MarkerType, Panel, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, type Connection, type Edge, type Node } from '@xyflow/react';
import { evaluateExpression, inferKind, type EvalResult, type SerialisedObjectDeclaration } from '../common/expression-evaluator';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';

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
import { computeContainRect, normalizedToPixel, pixelToNormalized, type Size } from './map-coords';

const LocationView = () => {
  let {locationName} = useParams()
  let {worldState} = useContext(DslContext)

  let [locationData, setLocationData] = useState<SerializedLocation | undefined>(undefined)
  // null = calculated but not resolvable (e.g. FunctionCall/RefChain)
  // undefined = not yet calculated (button not clicked)
  const [computedValues, setComputedValues] = useState<Record<string, EvalResult | null>>({})
  const [leftTab, setLeftTab] = useState<'variables' | 'npcs'>('variables')
  const [viewMode, setViewMode] = useState<'map' | 'tree'>('map')
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null)

  const calculateVariable = (variable: SerializedVariableDecl, key?: string) => {
    const storeKey = key ?? variable.target ?? ''
    const result = evaluateExpression(variable.value, { variableName: variable.target, worldState })
    const updates: Record<string, EvalResult | null> = { [storeKey]: result ?? null }

    if (result !== null && typeof result === 'object') {
      const obj = result as SerialisedObjectDeclaration
      for (const propDecl of obj.computedPropertyDecls) {
        const propKey = `${storeKey}.${propDecl.target ?? ''}`
        const propResult = evaluateExpression(propDecl.value, { variableName: propDecl.target, worldState })
        updates[propKey] = propResult ?? null
      }
    }

    setComputedValues(prev => ({ ...prev, ...updates }))
  }

  const renderValueToken = (value: EvalResult | null | undefined) => {
    if (value === null || value === undefined) return <span className="tok-comment italic">?</span>
    const kind = inferKind(value)
    if (kind === 'string') return <span className="tok-string">"{value as string}"</span>
    if (kind === 'int') return <span className="tok-number">{value as number}</span>
    if (kind === 'bool') return <span className="tok-keyword">{String(value)}</span>
    return <span className="tok-operator">{String(value)}</span>
  }

  const renderObjectProps = (obj: SerialisedObjectDeclaration, parentKey: string) => (
    <div style={{ marginLeft: 16, marginTop: 2 }}>
      {Object.entries(obj.staticProperties).map(([propName, propValue]) => (
        <div key={propName} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="tok-variable">{propName}</span>
          <span className="tok-operator">=</span>
          {renderValueToken(propValue)}
        </div>
      ))}
      {obj.computedPropertyDecls.map((propDecl) => {
        const propKey = `${parentKey}.${propDecl.target ?? ''}`
        const hasPropCalc = propKey in computedValues
        const propComputed = computedValues[propKey]
        return (
          <div key={propDecl.target} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="tok-comment">computed</span>
            <span className="tok-variable">{propDecl.target}</span>
            <button className="var-calc-btn" onClick={() => calculateVariable(propDecl, propKey)}>
              Calculate
            </button>
            {hasPropCalc && (
              <>
                <span className="tok-operator">=</span>
                {renderValueToken(propComputed)}
              </>
            )}
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

  const selectedVar = locationData?.variables.find(v => v.target === selectedVariable)

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
                  const isSelected = selectedVariable === variable.target

                  if (isComputed) {
                    const key = variable.target ?? ''
                    const hasCalculated = key in computedValues
                    const computed = computedValues[key]

                    // Evaluate eagerly to get object structure for preview (safe - ObjectDeclaration has no side effects)
                    const preview = evaluateExpression(variable.value, { variableName: variable.target, worldState })
                    const previewObj = preview !== null && typeof preview === 'object'
                      ? preview as SerialisedObjectDeclaration
                      : undefined

                    return (
                      <div
                        key={variable.target}
                        className={"var-row " + (isSelected ? 'selected' : '')}
                        style={{ alignItems: 'flex-start' }}
                        onClick={() => setSelectedVariable(variable.target ?? null)}
                      >
                        <div className="gutter">{i + 1}</div>
                        <div>
                          <div className="declaration">
                            <span className="tok-comment">computed</span>
                            <span className="tok-variable">{variable.target}</span>
                            {!previewObj && (
                              <button className="var-calc-btn" onClick={(e) => { e.stopPropagation(); calculateVariable(variable) }}>
                                Calculate
                              </button>
                            )}
                            {!previewObj && hasCalculated && (
                              <>
                                <span className="tok-operator">=</span>
                                {renderValueToken(computed)}
                              </>
                            )}
                          </div>
                          {previewObj && renderObjectProps(previewObj, key)}
                        </div>
                      </div>
                    )
                  }

                  const value = evaluateExpression(variable.value, { variableName: variable.target, worldState })
                  if (typeof value === 'object') {
                    const obj = value as SerialisedObjectDeclaration
                    return (
                      <div
                        key={variable.target}
                        className={"var-row " + (isSelected ? 'selected' : '')}
                        style={{ alignItems: 'flex-start' }}
                        onClick={() => setSelectedVariable(variable.target ?? null)}
                      >
                        <div className="gutter">{i + 1}</div>
                        <div>
                          <div className="declaration">
                            <span className="tok-keyword">object</span>
                            <span className="tok-variable">{variable.target}</span>
                          </div>
                          {renderObjectProps(obj, variable.target ?? '')}
                        </div>
                      </div>
                    )
                  }

                  const kind = inferKind(value)
                  return (
                    <div
                      key={variable.target}
                      className={"var-row " + (isSelected ? 'selected' : '')}
                      onClick={() => setSelectedVariable(variable.target ?? null)}
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

              {selectedVar && (
                <div className="var-doc">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="tok-type">{selectedVar.isComputed === 'computed' ? 'computed' : 'let'}</span>
                    <span className="tok-variable">{selectedVar.target}</span>
                  </div>
                  <div className="meta">
                    <span><strong>computed:</strong> {selectedVar.isComputed === 'computed' ? 'yes' : 'no'}</span>
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

const MapFlow = ({location, mode}: { location: SerializedLocation | undefined, mode: 'map' | 'tree' }) => {
const navigate = useNavigate();
const containerRef = useRef<HTMLDivElement>(null);
let { getByReference, adventure, world } = useContext(DslContext)
const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
const [mapImage, setMapImage] = useState<{ url: string; natural: Size } | null>(null);

  // "Usable" area - same margin the canvas has always used, whether or not an image is present.
  const usableSize: Size = { width: Math.max(containerSize.width - 20, 100), height: Math.max(containerSize.height - 20, 100) };
  const mapBounds: [[number, number], [number, number]] = [[0, 0], [usableSize.width, usableSize.height]];
  // The rect every node position is normalized against: the image's letterboxed
  // contain-rect when one resolves, otherwise the full usable canvas (today's behavior).
  const rect = computeContainRect(usableSize, mapImage?.natural ?? null);
  const rectRef = useRef(rect);

  const nodeTypes = {
    mapNode: MapNode,
  };

  const edgeTypes = {
    floating: FloatingEdge,
  };

  const nodeOrigin: [number, number] = [0.5, 0];

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

  const proOptions = { hideAttribution: true };

  // Track the container's rendered size (drives both mapBounds and the image contain-rect).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      setContainerSize({ width, height });
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
    if (!location) { setMapImage(null); return; }
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

  // Whenever the map rect changes (window resize, or an image resolving/swapping),
  // re-project every node's pixel position through the old->new rect so it stays
  // visually anchored to the same normalized point instead of jumping.
  useEffect(() => {
    const oldRect = rectRef.current;
    const changed = oldRect.x !== rect.x || oldRect.y !== rect.y || oldRect.width !== rect.width || oldRect.height !== rect.height;
    if (changed && oldRect.width > 0 && oldRect.height > 0) {
      setNodes(nds => nds.map(n => {
        const norm = pixelToNormalized(oldRect, n.position.x, n.position.y);
        return { ...n, position: normalizedToPixel(rect, norm.x, norm.y) };
      }));
    }
    rectRef.current = rect;
  }, [rect.x, rect.y, rect.width, rect.height]);

  useEffect(() => {
    if (typeof location == "undefined") return;

    const graph = buildGraphFromLocation(location, getByReference) || buildDefaultGraph();
    setEdges(graph.edges);

    if (mode === 'tree') {
      const treeNodes = layoutAsTree(graph.nodes, location.name);
      setNodes(treeNodes.map(n => ({ ...n, position: normalizedToPixel(rect, n.position.x, n.position.y) })));
      return;
    }

    fetch(`${BackendURL}/file/layout/load?adventure=${adventure}&world=${world}&location=${encodeURIComponent(location.name)}`)
      .then(r => r.json())
      .then((saved: Record<string, { x: number; y: number }>) => {
        setNodes(graph.nodes.map(node => {
          // Saved positions (and buildGraphFromLocation's {x:0,y:0} default) are
          // both normalized fractions - always project through the current rect.
          const norm = saved[node.id] ?? node.position;
          return { ...node, position: normalizedToPixel(rect, norm.x, norm.y) };
        }));
      })
      .catch(() => setNodes(graph.nodes.map(node => ({ ...node, position: normalizedToPixel(rect, node.position.x, node.position.y) }))));
  }, [location?.name, mode]);

  useEffect(() => {
    if (typeof location == "undefined" || mode !== 'map') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 's') return;
      e.preventDefault();
      const positions = Object.fromEntries(nodes.map(n => [n.id, pixelToNormalized(rect, n.position.x, n.position.y)]));
      fetch(`${BackendURL}/file/layout/save?adventure=${adventure}&world=${world}&location=${encodeURIComponent(location!.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positions),
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [nodes, location?.name, adventure, world, mode, rect]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" style={{ background: 'var(--bg-editor)', position: 'relative' }}>
      {mapImage && (
        <img
          src={mapImage.url}
          alt=""
          style={{
            position: 'absolute',
            left: rect.x, top: rect.y, width: rect.width, height: rect.height,
            objectFit: 'contain', pointerEvents: 'none', userSelect: 'none',
          }}
        />
      )}
      {mapBounds[1][0] > 0 &&
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
          nodeOrigin={nodeOrigin}
          // Types and Options
          proOptions={proOptions}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={FloatingConnectionLine}
          // Manually controlled bounds and zoom
          translateExtent={mapBounds}
          nodeExtent={mapBounds}
          // Camera defaults (No fitView)
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={1}
          maxZoom={1}
          // Locking
          panOnDrag={false}
          selectionOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={true}
          nodesDraggable={mode === 'map'}
          // Styles
        >
          {!mapImage && <Background variant={BackgroundVariant.Dots} color="var(--bd-soft)" gap={16} />}
          <Panel position="top-right" style={{
            background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', color: 'var(--fg-secondary)',
            padding: '4px 10px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>
            {mode === 'map' ? 'Draggable · Ctrl+S to save' : 'Tree layout · read-only'}
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