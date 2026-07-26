"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function GatewayNodeBase({ data, selected, type }: NodeProps) {
  const isParallel = type === "parallelGateway";
  const icon = isParallel ? "+" : "✕";
  const borderColor = selected ? "border-blue-500" : "border-amber-500";

  return (
    <div
      className={`flex items-center justify-center w-11 h-11 rotate-45 border-2 ${borderColor} bg-amber-50 transition-shadow ${
        selected ? "shadow-md" : ""
      }`}
      role="img"
      aria-label={`${isParallel ? "Parallel" : "Exclusive"} gateway: ${data.label || "Gateway"}`}
    >
      <span className="text-amber-700 text-sm -rotate-45 font-bold" aria-hidden="true">
        {icon}
      </span>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-white !border-2 !-start-[7px] !-rotate-45"
        aria-label="Incoming connection"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-white !border-2 !-end-[7px] !-rotate-45"
        aria-label="Outgoing connection"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-white !border-2 !-bottom-[7px] !-rotate-45"
        aria-label="Outgoing connection (bottom)"
      />
      {data.label && (
        <div className="absolute -bottom-7 start-1/2 -translate-x-1/2 -rotate-45 text-[10px] text-slate-600 whitespace-nowrap font-medium">
          {data.label}
        </div>
      )}
    </div>
  );
}

export const GatewayNode = memo(GatewayNodeBase);
