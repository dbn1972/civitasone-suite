"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function EndEventNodeBase({ data, selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${
        selected ? "border-blue-500 shadow-md" : "border-red-500"
      } bg-red-50 transition-shadow`}
      role="img"
      aria-label={`End event: ${data.label || "End"}`}
    >
      <span className="text-red-600 text-lg" aria-hidden="true">■</span>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-red-500 !border-white !border-2"
        aria-label="Connect to end event"
      />
      {data.label && data.label !== "End" && (
        <div className="absolute -bottom-5 start-1/2 -translate-x-1/2 text-[10px] text-slate-600 whitespace-nowrap font-medium">
          {data.label}
        </div>
      )}
    </div>
  );
}

export const EndEventNode = memo(EndEventNodeBase);
