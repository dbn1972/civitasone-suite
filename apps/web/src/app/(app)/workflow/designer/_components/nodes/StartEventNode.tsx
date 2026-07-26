"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function StartEventNodeBase({ data, selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${
        selected ? "border-blue-500 shadow-md" : "border-green-500"
      } bg-green-50 transition-shadow`}
      role="img"
      aria-label={`Start event: ${data.label || "Start"}`}
    >
      <span className="text-green-600 text-lg" aria-hidden="true">▶</span>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-green-500 !border-white !border-2"
        aria-label="Connect from start event"
      />
      {data.label && data.label !== "Start" && (
        <div className="absolute -bottom-5 start-1/2 -translate-x-1/2 text-[10px] text-slate-600 whitespace-nowrap font-medium">
          {data.label}
        </div>
      )}
    </div>
  );
}

export const StartEventNode = memo(StartEventNodeBase);
