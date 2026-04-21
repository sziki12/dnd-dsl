import { useCallback, useState, useRef, useEffect } from 'react';
import test_map_image from '../assets/test_map_image.webp';
import { addEdge, Background, MarkerType, Panel, ReactFlow, useEdgesState, useNodesState, type Connection, type Node } from '@xyflow/react';

import MapNode from '../nodes/MapNode.js';

const LocationView = () => {
  return (
    // 1. Parent Container: use 'flex' and 'flex-col lg:flex-row' for responsiveness
    <div className="h-screen w-full bg-slate-900 text-white p-4 flex flex-col lg:flex-row gap-4">
      {/* 2. Left Column: Variables Panel */}
      <div className="flex-1 flex flex-col items-center justify-center min-w-75 max-w-full">
        <h1 className="text-4xl font-bold mb-6">Location View</h1>
        
        {/* Tab Buttons */}
        <div className="flex gap-2 mb-4">
          <button className="bg-gray-700 px-4 py-1 rounded text-sm hover:bg-gray-600">Variables</button>
          <button className="bg-gray-700 px-4 py-1 rounded text-sm hover:bg-gray-600">NPCs</button>
        </div>

        {/* Content List */}
        <div className="text-center space-y-2 text-gray-300">
          <p className="text-sm font-semibold text-gray-400">Variables</p>
          <p>int population = 100</p>
          <p>int food = 2</p>
          <p>string state = "Peace"</p>
          <div className="flex justify-center items-center gap-2">
            <input type="checkbox" checked readOnly className="accent-blue-500" />
            <span>bool IsStarving</span>
          </div>
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
          <MapFlow />
        </div>
        
        {/* Location Labels (moved below map) */}
        <div className="mt-4 space-y-1 text-center">
          <p className="text-gray-400">Sub location 1</p>
          <p className="text-gray-400">Sub location 2</p>
        </div>
      </div>

    </div>
  );
};

const MapFlow = () => {
const containerRef = useRef<HTMLDivElement>(null);
const [mapBounds, setMapBounds] = useState<[[number, number], [number, number]]>([[0, 0], [0, 0]]);
const targetSize = 50;
const markerColor = '#000000';
  const initialNodes: Node<{ location: string }>[] = [
    { id: 'n1', position: { x: 50, y: 50 }, data: { location: 'Place 1' }, type: 'mapNode' },
    { id: 'n2', position: { x: 100, y: 100 }, data: { location: 'Place 2' }, type: 'mapNode' },
  ];
  const initialEdges = [{
    id: 'n1-n2',
    source: 'n1',
    target: 'n2',
    label: 'Transition Name',
    data: { direction: 'both' },
    type: 'straight',
    markerStart: {
      type: MarkerType.ArrowClosed,
      width: targetSize,
      height: targetSize,
      color: markerColor,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: targetSize,
      height: targetSize,
      color: markerColor,
    },
  }];

  const nodeTypes = {
    mapNode: MapNode,
  };
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onEdgeClick = useCallback((_event: React.MouseEvent, clickedEdge: any) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === clickedEdge.id) {
          const currentDir = edge.data?.direction || 'both';
          
          // Cycle: end → start → both
          const directionOrder = ['end', 'start', 'both'];
          const currentIndex = directionOrder.indexOf(currentDir);
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

  return (
    <div ref={containerRef} className="border-4 w-full aspect-square rounded-lg overflow-hidden bg-slate-800">   
      {mapBounds[1][0] > 0 && 
      (
        <ReactFlow
          nodes={nodes}
          edges={edges}

          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          
          proOptions={proOptions}
          nodeTypes={nodeTypes}
          // MANUALLY CONTROLLED BOUNDS
          translateExtent={mapBounds}
          nodeExtent={mapBounds}
          // CAMERA DEFAULTS (No fitView)
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={1}
          maxZoom={1}
          // LOCKING
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

export default LocationView;