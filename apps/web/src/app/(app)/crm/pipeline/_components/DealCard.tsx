"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/formatters";
import { PredictionBadge } from "../../../../_components/ds/PredictionBadge";
import type { PipelineDealCard } from "../../../../_data/loaders";

type Props = {
  deal: PipelineDealCard;
  isMoving: boolean;
  isDragging: boolean;
  onDragStart: (dealId: string) => void;
  onKeyboardMove: (dealId: string, direction: "left" | "right") => void;
};

/**
 * One engagement on the board.
 *
 * GAP-CRM-PIPELINE-06 (rescan): the card used to be `role="button" tabIndex=0` WRAPPING the
 * record link. axe flags that as `nested-interactive` (a button's children are presentational,
 * so the focusable link inside it is unreachable/ambiguous to assistive tech). The card is now
 * a plain labelled group (still mouse-draggable) holding two SEPARATE controls:
 *   - a real <button> move handle: Tab to it, then Left/Right arrows move the engagement
 *     between stages (same keyboard path as before, now on the control that owns it);
 *   - the engagement-name link: Tab to it and press Enter to open the record.
 */
export function DealCard({ deal, isMoving, isDragging, onDragStart, onKeyboardMove }: Props) {
  const t = useTranslations("crmDealCard");
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", deal.id);
      onDragStart(deal.id);
    },
    [deal.id, onDragStart],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
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
      role="group"
      aria-label={t("cardLabel", {
        name: deal.name,
        value: deal.valueDisplay,
        likelihood: deal.probability,
        hasAssignee: deal.contactName ? "yes" : "no",
        assignee: deal.contactName ?? "",
      })}
      aria-roledescription={t("roleDescription")}
      className={`cursor-grab rounded-lg border p-3 shadow-sm transition-all select-none ${
        isDragging
          ? "border-blue-300 bg-blue-50 opacity-50"
          : isMoving
            ? "border-amber-300 bg-amber-50 animate-pulse"
            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
      } focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1`}
    >
      {/* Engagement name + keyboard move handle */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onKeyDown={handleKeyDown}
          aria-label={t("moveHandle", { name: deal.name })}
          className="mt-0.5 cursor-grab rounded px-0.5 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <a
          href={`/crm/deals/${deal.id}`}
          className="text-sm font-medium text-slate-900 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        >
          {deal.name}
        </a>
      </div>

      {/* Value and likelihood */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">
          {formatMoney(deal.valueMinor)}
        </span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          {deal.probability}%
        </span>
      </div>

      {/* ML Prediction Badge */}
      {deal.prediction != null && (
        <div className="mt-1.5">
          <PredictionBadge
            confidence={deal.prediction.confidence}
            label={`${Math.round(deal.prediction.probability * 100)}% conversion`}
            factors={deal.prediction.factors}
            isFallback={deal.prediction.isFallback}
          />
        </div>
      )}

      {/* Contact / assignee */}
      {deal.contactName && (
        <p className="mt-1 truncate text-xs text-slate-500">
          {deal.contactName}
        </p>
      )}

      {/* Moving indicator */}
      {isMoving && (
        <p className="mt-1 text-[10px] text-amber-600" role="status" aria-live="polite">
          {t("updating")}
        </p>
      )}
    </div>
  );
}
