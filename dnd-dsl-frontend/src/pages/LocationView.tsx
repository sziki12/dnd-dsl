import { useCallback, useState } from 'react';
import test_map_image from '../assets/test_map_image.webp';
import { addEdge, applyEdgeChanges, applyNodeChanges, Background, Panel, ReactFlow, useEdgesState, useNodesState, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';

const LocationView = () => {
  const [activeTab, setActiveTab] = useState('Variables');

  return (
    // 1. Parent Container: use 'flex' and 'flex-col lg:flex-row' for responsiveness
    <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col lg:flex-row gap-8">
      
      {/* 2. Left Column: Variables Panel */}
      <div className="w-full lg:w-1/3 flex flex-col items-center">
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
      <div className="w-full lg:w-2/3 flex flex-col items-center">
        {/* Map/Tree Toggle */}
        <div className="flex gap-2 mb-4 self-center lg:self-end">
          <button className="bg-gray-700 px-3 py-1 rounded text-xs">Map</button>
          <button className="bg-gray-700 px-3 py-1 rounded text-xs">Tree</button>
        </div>

        {/* Map Image Container */}
        <MapFlow />
        
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
  const initialNodes: Node<{ label: string }>[] = [
    { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } },
    { id: 'n2', position: { x: 0, y: 50 }, data: { label: 'Node 2' } },
  ];
  const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const proOptions = { hideAttribution: true };
  // Define the boundaries of your map frame (e.g., 0 to 800px wide, 0 to 600px high)
  const mapBounds: [[number, number], [number, number]] = [[0, 0], [400, 400]];
  return (
    <div className="border-4" 
    style={{ width: '800px', height: '800px' }}>  
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        // LOCK THE CANVAS
        panOnDrag={false}
        selectionOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={true}
        // Ensure nodes stay interactive
        nodesDraggable={true}
        // This prevents nodes from being dragged outside these coordinates
        translateExtent={mapBounds}
        // Recommended: prevent the user from zooming out and seeing the "void"
        nodeExtent={mapBounds}
        proOptions={proOptions}
        fitView
      >
        {/* The Image Layer */}
        <Background 
          style={{
          backgroundImage: `url('${test_map_image}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.6,
        }}
        // We remove the dots/lines by setting color to transparent
        color="transparent" 
      />
        
        <Panel position="top-right" className="bg-white p-2 rounded shadow">
          Canvas Locked | Nodes Draggable
        </Panel>
      </ReactFlow>
    </div>
  );
};

export default LocationView;