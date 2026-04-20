import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
 
function MapNode({ data }: any) {
 
  return (
    <div className="px-2 py-2 shadow-md rounded-md bg-white border-2 border-stone-400">
      <Handle
        type="target"
        position={Position.Top}
        className="w-16 bg-gray-500!"
        isConnectable={true}
      />

      <div className="flex">
        <div className="ml-2">
          <div className="text-lg font-bold text-black">{data.location}</div>
        </div>
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-16 bg-gray-500!"
        isConnectable={true}
      />
    </div>
  );
}
 
export default memo(MapNode);