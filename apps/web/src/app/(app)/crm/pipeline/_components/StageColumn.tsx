"use client";

import type { DragEvent, ReactNode } from "react";
import { useCallback } from "react";
import { formatMoney } from "@/lib/formatters";

type Props = {
  stageId: string;
  stageName: string;
  probability: number;
  dealCount: number;
  totalValue: bigint;
  isDropTarget: boolean;
  onDragOver: (stageId: string) => void;
  onDragLeave: () => void;
  onDrop: (stageId: string) => void;
  children: ReactNode;
};

export function StageColumn({
  stageId,
  stageName,
  probability,
  dealCount,
  totalValue,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: Props) {
  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDragOver(stageId);
    },
    [stageId, onDragOver],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      onDragOver(stageId);
    },
    [stageId, onDragOver],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Only fire when leaving the column itself (not children)
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      onDragLeave();
    },
    [onDragLeave],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      onDrop(stageId);
    },
    [stageId, onDrop],
  );

  return (
    <div
      className={`flex w-72 flex-shrink-0 flex-col rounded-xl border bg-white transition-colors ${
        isDropTarget
          ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
          : "border-slate-200"
      }`}
      role="region"
      aria-label={`${stageName} stage — ${dealCount} deals, ${formatMoney(totalValue)} value`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Stage header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{stageName}</h3>
          <p className="text-xs text-slate-500">
            {dealCount} deal{dealCount !== 1 ? "s" : ""} · {probability}% prob
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {formatMoney(totalValue)}
        </span>
      </div>

      {/* Deal cards container */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" style={{ minHeight: 120, maxHeight: 520 }}>
        {children}
        {dealCount === 0 && (
          <div className="flex flex-1 items-center justify-center text-center text-xs text-slate-400">
            Drop deals here
          </div>
        )}
      </div>
    </div>
  );
}
