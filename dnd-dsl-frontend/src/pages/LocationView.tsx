import { useCallback, useState, useRef, useEffect, useContext } from 'react';
import test_map_image from '../assets/test_map_image.webp';

import { addEdge, Background, MarkerType, Panel, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, type Connection, type Edge, type Node } from '@xyflow/react';
import type { SerializedModel, SerializedLocation, SerializedVariableDecl, SerializedLocationExit } from '../common/model-types';
import { evaluateExpression, type EvalResult, type SerialisedObjectDeclaration } from '../common/expression-evaluator';
import Button from '@mui/material/Button';

import MapNode from '../nodes/MapNode.js';
import { useParams } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext.js';
import FloatingEdge from '../edges/FloatingEdge.js';
import FloatingConnectionLine from '../edges/FloatingConnectionLine.js';

const LocationView = () => {
  let {locationName} = useParams()
  let {worldState} = useContext(DslContext)
  
  let [locationData, setLocationData] = useState<SerializedLocation | undefined>(undefined)
  // null = calculated but not resolvable (e.g. FunctionCall/RefChain)
  // undefined = not yet calculated (button not clicked)
  const [computedValues, setComputedValues] = useState<Record<string, EvalResult | null>>({})

  const calculateVariable = (variable: SerializedVariableDecl, key?: string) => {
    const storeKey = key ?? variable.target ?? ''
    const result = evaluateExpression(variable.value, { variableName: variable.target, worldState })
    setComputedValues(prev => ({ ...prev, [storeKey]: result ?? null }))
  }

  const renderObjectProps = (obj: SerialisedObjectDeclaration, parentKey: string) => (
    <>
      {Object.entries(obj.staticProperties).map(([propName, propValue]) => (
        <p key={propName}>{propName}: {propValue?.toString() ?? '?'}</p>
      ))}
      {obj.computedPropertyDecls.map((propDecl) => {
        const propKey = `${parentKey}.${propDecl.target ?? ''}`
        const hasPropCalc = propKey in computedValues
        const propComputed = computedValues[propKey]
        return (
          <div key={propDecl.target} className="flex items-center gap-2">
            <span>{propDecl.target}</span>
            <Button variant="contained" size="small" onClick={() => calculateVariable(propDecl, propKey)}>
              Calculate
            </Button>
            {hasPropCalc && (
              propComputed === null
                ? <span className="text-gray-500 italic">?</span>
                : <span>= {propComputed!.toString()}</span>
            )}
          </div>
        )
      })}
    </>
  )

  useEffect(()=>{

    const newLocation = getLocationData(worldState, locationName ?? "Lcoation")
    if(typeof(newLocation) == "undefined")
      return
    setLocationData(newLocation)
  },[worldState])
  return (
    // 1. Parent Container: use 'flex' and 'flex-col lg:flex-row' for responsiveness
    <div className="h-screen w-full bg-slate-900 text-white p-4 flex flex-col lg:flex-row gap-4">
      {/* 2. Left Column: Variables Panel */}
      <div className="flex-1 flex flex-col items-center justify-center min-w-75 max-w-full">
        <h1 className="text-4xl font-bold mb-6">{locationName}</h1>
        
        {/* Tab Buttons */}
        <div className="flex gap-2 mb-4">
          <button className="bg-gray-700 px-4 py-1 rounded text-sm hover:bg-gray-600">Variables</button>
          <button className="bg-gray-700 px-4 py-1 rounded text-sm hover:bg-gray-600">NPCs</button>
        </div>

        {/* Content List */}
        <div className="text-center space-y-2 text-gray-300">
          <p className="text-sm font-semibold text-gray-400">Variables</p>
          {
            locationData?.variables.map((variable: SerializedVariableDecl) => {
              const isComputed = variable.isComputed === 'computed'
              console.log(`Variable ${variable.target} is computed: ${isComputed}`)
              if (isComputed) {
                const key = variable.target ?? ''
                const hasCalculated = key in computedValues
                const computed = computedValues[key]  // EvalResult | null | undefined
                const computedObj = computed !== null && typeof computed === 'object'
                  ? computed as SerialisedObjectDeclaration
                  : undefined
                return (
                  <div key={variable.target} className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-2">
                      <span>{variable.target}</span>
                      <Button variant="contained" size="small" onClick={() => calculateVariable(variable)}>
                        Calculate
                      </Button>
                    </div>
                    {hasCalculated && (
                      computed === null ? (
                        <span className="text-gray-500 italic">= ?</span>
                      ) : computedObj ? (
                        <div className="border p-2 rounded bg-gray-800 w-full text-left">
                          {renderObjectProps(computedObj, key)}
                        </div>
                      ) : (
                        <span className="text-gray-300">= {computed!.toString()}</span>
                      )
                    )}
                  </div>
                )
              }

              let value = evaluateExpression(variable.value, { variableName: variable.target, worldState })
              if (typeof value === 'object') {
                const obj = value as SerialisedObjectDeclaration
                return (
                  <div key={variable.target} className="border p-2 rounded bg-gray-800">
                    <p className="font-bold">{variable.target}</p>
                    <div className="text-left ml-4">
                      {renderObjectProps(obj, variable.target ?? '')}
                    </div>
                  </div>
                )
              }
              return (<p key={variable.target}>{variable.target} = {value?.toString() ?? '?'}</p>)
            })
          }
          <p className="text-xs italic text-gray-500 max-w-xs mt-4">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit...
          </p>
        </div>
      </div>

      {/* 3. Right Column: Map Panel */}
      <div className="flex-1 flex flex-col items-center justify-center min-w-75 max-w-full">
        {/* Map/Tree Toggle */}
        <div className="flex gap-2 mb-4 self-center lg:self-end">
          <button className="bg-gray-700 px-3 py-1 rounded text-xs">Map</button>
          <button className="bg-gray-700 px-3 py-1 rounded text-xs">Tree</button>
        </div>

        {/* Map Image Container */}
        <div className="w-full h-[60vw] max-h-[80vh] min-h-75 min-w-75 flex items-center justify-center">
          <ReactFlowProvider>
            <MapFlow location={locationData} />
          </ReactFlowProvider>
        </div>
      </div>

    </div>
  );
};

const MapFlow = ({location}: { location: SerializedLocation | undefined }) => {
const containerRef = useRef<HTMLDivElement>(null);
let { getByReference } = useContext(DslContext)
const [mapBounds, setMapBounds] = useState<[[number, number], [number, number]]>([[0, 0], [0, 0]]);
const targetSize = 50;
const markerColor = '#000000';

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

  // Edge click handler to toggle direction
  const onEdgeClick = useCallback((_event: React.MouseEvent, clickedEdge: any) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === clickedEdge.id) {
          const currentDir = edge.data?.direction || 'both';
          
          // Cycle: end → start → both
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
  }, [setEdges]);

  const proOptions = { hideAttribution: true };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const { width, height } = container.getBoundingClientRect();
      const newBounds: [[number, number], [number, number]] = [[0, 0], [Math.max(width - 20, 100), Math.max(height - 20, 100) ]];
      setMapBounds(newBounds);
    };

    updateBounds();

    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if(typeof(location) == "undefined")
      return;

    const graph = buildGraphFromLocation(location, getByReference) || buildDefaultGraph()
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [location]);

  return (
    <div ref={containerRef} className="border-4 w-full aspect-square rounded-lg overflow-hidden bg-slate-800">   
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
          nodesDraggable={true}
          // Styles
        >
          {/* The Image Layer */}
          <Background 
            style={{
              backgroundImage: `url('${test_map_image}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.6,
            }}
            color="transparent" 
          />
          <Panel position="top-right" className="bg-gray-100 p-2 rounded shadow text-black">
            Canvas Locked | Nodes Draggable
          </Panel>
      </ReactFlow>
      )}
    </div>
  );
};

function buildGraphFromLocation(location: SerializedLocation, getByReference: <T extends object>(ref: string | undefined) => T | undefined) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const knownIds = new Set(location.sublocations.map(s => s.name));

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
    const targetName = getByReference<SerializedLocation>(exit.exit?.$ref)?.name ?? 'Unknown';
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
  }

  for (const sub of location.sublocations) {
    nodes.push({
      id: sub.name,
      type: 'mapNode',
      position: { x: 0, y: 0 }, // laid out by auto-layout
      data: {
        location: sub.name,
        isEntry: getByReference<SerializedLocation>(location.entry?.entry.$ref)?.name === sub.name,
      },
      parentId: location.name,
    });

    for (const exit of sub.exits ?? []) {
      console.log(`sub -> exit.exit?.$ref ${exit.exit?.$ref}`);
      const targetName = getByReference<SerializedLocation>(exit.exit?.$ref)?.name ?? 'Unknown';
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
            isEntry: getByReference<SerializedLocation>(location.entry?.entry.$ref)?.name === targetName,
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
        markerEnd: { type: MarkerType.ArrowClosed },
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

const getLocationData = (worldState: SerializedModel | undefined, locationName: string) =>
{
  if(worldState?.World == undefined)
    return undefined
  return worldState.World.locations.find(location => location.name == locationName)
}

export default LocationView;