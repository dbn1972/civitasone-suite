"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function TaskNodeBase({ data, selected }: NodeProps) {
  return (
    <div
      className={`rounded-lg border-2 ${
        selected ? "border-blue-500 shadow-md" : "border-slate-300"
      } bg-white px-4 py-2.5 min-w-[120px] max-w-[200px] transition-shadow`}
      role="img"
      aria-label={`Task: ${data.label || "Task"}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-slate-400 !border-white !border-2"
        aria-label="Incoming connection"
      />
      <div className="flex items-center gap-2">
        <span className="text-slate-400 text-xs shrink-0" aria-hidden="true">◻</span>
        <span className="text-sm font-medium text-slate-700 truncate">
          {data.label || "Task"}
        </span>
      </div>
      {data.assignee && (
        <div className="mt-1 text-[10px] text-slate-400 truncate">
          👤 {data.assignee}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-slate-400 !border-white !border-2"
        aria-label="Outgoing connection"
      />
    </div>
  );
}

export const TaskNode = memo(TaskNodeBase);
