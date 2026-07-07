"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useCallback } from "react";
import { formatMoney } from "@/lib/formatters";
import type { PipelineDealCard } from "../../../../_data/loaders";

type Props = {
  deal: PipelineDealCard;
  isMoving: boolean;
  isDragging: boolean;
  onDragStart: (dealId: string) => void;
  onKeyboardMove: (dealId: string, direction: "left" | "right") => void;
};

export function DealCard({ deal, isMoving, isDragging, onDragStart, onKeyboardMove }: Props) {
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", deal.id);
      onDragStart(deal.id);
    },
    [deal.id, onDragStart],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onKeyboardMove(deal.id, "left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onKeyboardMove(deal.id, "right");
      }
    },
    [deal.id, onKeyboardMove],
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Deal: ${deal.name}, value ${deal.valueDisplay}, probability ${deal.probability}%, ${deal.contactName ? `assignee ${deal.contactName}` : "unassigned"}. Use left and right arrow keys to move between stages.`}
      aria-grabbed={isDragging}
      className={`cursor-grab rounded-lg border p-3 shadow-sm transition-all select-none ${
        isDragging
          ? "border-blue-300 bg-blue-50 opacity-50"
          : isMoving
            ? "border-amber-300 bg-amber-50 animate-pulse"
            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1`}
    >
      {/* Deal name */}
      <a
        href={`/crm/deals/${deal.id}`}
        className="text-sm font-medium text-slate-900 hover:text-blue-700 hover:underline"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        draggable={false}
      >
        {deal.name}
      </a>

      {/* Value and probability */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">
          {formatMoney(deal.valueMinor)}
        </span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          {deal.probability}%
        </span>
      </div>

      {/* Contact / assignee */}
      {deal.contactName && (
        <p className="mt-1 truncate text-xs text-slate-500">
          {deal.contactName}
        </p>
      )}

      {/* Moving indicator */}
      {isMoving && (
        <p className="mt-1 text-[10px] text-amber-600" role="status" aria-live="polite">
          Updating…
        </p>
      )}
    </div>
  );
}
