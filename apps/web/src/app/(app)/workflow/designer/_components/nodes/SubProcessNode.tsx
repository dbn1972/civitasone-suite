"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function SubProcessNodeBase({ data, selected }: NodeProps) {
  return (
    <div
      className={`rounded-lg border-2 border-dashed ${
        selected ? "border-blue-500 shadow-md" : "border-indigo-400"
      } bg-indigo-50 px-4 py-3 min-w-[140px] max-w-[220px] transition-shadow`}
      role="img"
      aria-label={`Sub-process: ${data.label || "Sub-Process"}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-white !border-2"
        aria-label="Incoming connection"
      />
      <div className="flex items-center gap-2">
        <span className="text-indigo-400 text-xs shrink-0" aria-hidden="true">▣</span>
        <span className="text-sm font-medium text-indigo-700 truncate">
          {data.label || "Sub-Process"}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-indigo-400">
        Expand to edit
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-white !border-2"
        aria-label="Outgoing connection"
      />
    </div>
  );
}

export const SubProcessNode = memo(SubProcessNodeBase);
