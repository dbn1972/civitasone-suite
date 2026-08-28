"use client";

import { useCallback, useRef, useState } from "react";
import { useSeededResource } from "@/lib/sync/resource";
import { EmptyState } from "../../../../_components/ds";
import type { PipelineDealCard, PipelineView } from "../../../../_data/loaders";
import { DealCard } from "./DealCard";
import { StageColumn } from "./StageColumn";

/**
 * Default stages used when no pipeline is configured.
 * The backend supports 3–10 stages; these are the default set.
 *
 * These ids ("lead", "proposal", ...) are synthetic — they exist only so the
 * board has something to key columns on locally. They are NOT real
 * crm.pipeline_stages rows, so they must never be sent to the backend as
 * `stageId`: PATCH /v1/crm/deals/:id/stage validates stageId with
 * z.string().uuid().optional() and 400s on a non-uuid value. See
 * moveDealToStage, which only includes stageId when `pipeline` (and therefore
 * a real, uuid-keyed stage) is present.
 */
const DEFAULT_STAGES = [
  { id: "lead", name: "Lead", probability: 10, ordinal: 0 },
  { id: "proposal", name: "Proposal", probability: 30, ordinal: 1 },
  { id: "negotiation", name: "Negotiation", probability: 60, ordinal: 2 },
  { id: "won", name: "Won", probability: 100, ordinal: 3 },
  { id: "lost", name: "Lost", probability: 0, ordinal: 4 },
];

type Props = {
  pipeline: PipelineView | null;
  deals: PipelineDealCard[];
  source: "api" | "error";
};

type MoveError = {
  dealId: string;
  message: string;
};

export function KanbanBoard({ pipeline, deals: serverDeals, source }: Props) {
  const { data: deals, fromCache, offline, cachedAt } = useSeededResource<PipelineDealCard[]>(
    "crm.pipeline.deals",
    serverDeals,
    source,
    (d) => d.length === 0,
  );

  const stages = pipeline?.stages ?? DEFAULT_STAGES;
  // True only when these are real crm.pipeline_stages rows (uuid ids) — see the
  // DEFAULT_STAGES doc comment above for why that distinction matters on PATCH.
  const hasRealPipeline = Boolean(pipeline?.stages && pipeline.stages.length > 0);
  const [localDeals, setLocalDeals] = useState<PipelineDealCard[]>(deals);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<MoveError | null>(null);
  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const announcerRef = useRef<HTMLDivElement>(null);

  // Keep local deals in sync when server data changes
  // (after initial render, seeded resource handles offline)
  if (deals !== localDeals && !movingDealId) {
    setLocalDeals(deals);
  }

  const announce = useCallback((message: string) => {
    if (announcerRef.current) {
      announcerRef.current.textContent = message;
    }
  }, []);

  const handleDragStart = useCallback((dealId: string) => {
    setDraggedDealId(dealId);
    setMoveError(null);
    const deal = localDeals.find((d) => d.id === dealId);
    if (deal) {
      announce(`Picked up engagement ${deal.name}. Use arrow keys or drop on a stage column.`);
    }
  }, [localDeals, announce]);

  const handleDragOver = useCallback((stageId: string) => {
    setDropTargetStage(stageId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetStage(null);
  }, []);

  const moveDealToStage = useCallback(async (dealId: string, targetStageId: string) => {
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal) return;

    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!targetStage) return;

    // If dropping on same stage, no-op
    if (deal.stageId === targetStageId || deal.stage === targetStage.name) {
      return;
    }

    // Optimistic update
    setMovingDealId(deal.id);
    const previousDeals = [...localDeals];
    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === deal.id
          ? { ...d, stageId: targetStageId, stage: targetStage.name, probability: targetStage.probability }
          : d,
      ),
    );

    try {
      const res = await fetch(`/api/proxy/v1/crm/deals/${deal.id}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          stage: targetStage.name,
          // Only a real pipeline's stages have a uuid id — DEFAULT_STAGES' ids
          // ("lead", "proposal", ...) are synthetic and would fail the
          // backend's z.string().uuid() check on this field, 400ing every move
          // for a deal that has no pipeline. Move-by-name alone still works:
          // routes.ts falls back to matching by stage name when stageId is absent.
          ...(hasRealPipeline ? { stageId: targetStageId } : {}),
          probability: targetStage.probability,
          version: deal.version,
        }),
      });

      if (!res.ok) {
        // Revert on failure
        setLocalDeals(previousDeals);
        if (res.status === 409) {
          setMoveError({
            dealId: deal.id,
            message: "Version conflict — someone else updated this deal. Please refresh.",
          });
          announce(`Move failed for engagement ${deal.name}: version conflict. Please refresh.`);
        } else {
          const errBody = await res.json().catch(() => ({ error: { message: "Failed to move deal" } }));
          const msg = errBody?.error?.message ?? `Server error (${res.status})`;
          setMoveError({ dealId: deal.id, message: msg });
          announce(`Move failed for engagement ${deal.name}: ${msg}`);
        }
      } else {
        // Success — increment version locally
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === deal.id ? { ...d, version: d.version + 1 } : d,
          ),
        );
        announce(`Moved engagement ${deal.name} to ${targetStage.name} stage.`);
        setMoveError(null);
      }
    } catch {
      setLocalDeals(previousDeals);
      setMoveError({ dealId: deal.id, message: "Network error — check your connection." });
      announce(`Move failed for engagement ${deal.name}: network error.`);
    } finally {
      setMovingDealId(null);
    }
  }, [localDeals, stages, hasRealPipeline, announce]);

  const handleDrop = useCallback(async (targetStageId: string) => {
    if (!draggedDealId) return;
    setDraggedDealId(null);
    setDropTargetStage(null);
    await moveDealToStage(draggedDealId, targetStageId);
  }, [draggedDealId, moveDealToStage]);

  /**
   * Keyboard-based stage move for accessibility (WCAG 2.2 AA).
   * Users can press Enter on a deal card to enter "move mode",
   * then use Left/Right arrows to pick a stage.
   */
  const handleKeyboardMove = useCallback(async (dealId: string, direction: "left" | "right") => {
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal) return;

    const currentStageIdx = stages.findIndex(
      (s) => s.id === deal.stageId || s.name === deal.stage,
    );
    if (currentStageIdx === -1) return;

    const newIdx = direction === "left" ? currentStageIdx - 1 : currentStageIdx + 1;
    if (newIdx < 0 || newIdx >= stages.length) {
      announce(`Cannot move engagement ${deal.name} ${direction} — already at the ${direction === "left" ? "first" : "last"} stage.`);
      return;
    }

    const targetStage = stages[newIdx];
    await moveDealToStage(dealId, targetStage.id);
  }, [localDeals, stages, moveDealToStage, announce]);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  if (localDeals.length === 0 && stages.length > 0) {
    return (
      <div className="card">
        <EmptyState
          icon="📊"
          title="No deals in pipeline"
          message="Create a new deal to see it appear on the board."
          action={<a href="/crm/deals/new" className="btn primary">Create Deal</a>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cacheNote && (
        <p role="status" aria-live="polite" className="text-xs text-amber-700 px-1">
          {cacheNote}
        </p>
      )}

      {moveError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
        >
          {moveError.message}
          <button
            type="button"
            className="ms-2 underline"
            onClick={() => setMoveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live region for screen readers */}
      <div
        ref={announcerRef}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />

      <div
        className="flex gap-4 overflow-x-auto pb-4"
        role="group"
        aria-label="Pipeline stages"
      >
        {stages.map((stage) => {
          const stageDeals = localDeals.filter(
            (d) => d.stageId === stage.id || d.stage === stage.name,
          );
          const stageValue = stageDeals.reduce(
            (sum, d) => sum + BigInt(d.valueMinor || "0"),
            0n,
          );

          return (
            <StageColumn
              key={stage.id}
              stageId={stage.id}
              stageName={stage.name}
              probability={stage.probability}
              dealCount={stageDeals.length}
              totalValue={stageValue}
              isDropTarget={dropTargetStage === stage.id}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {stageDeals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  isMoving={movingDealId === deal.id}
                  isDragging={draggedDealId === deal.id}
                  onDragStart={handleDragStart}
                  onKeyboardMove={handleKeyboardMove}
                />
              ))}
            </StageColumn>
          );
        })}
      </div>
    </div>
  );
}
