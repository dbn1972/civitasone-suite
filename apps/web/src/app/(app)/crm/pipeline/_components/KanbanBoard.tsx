"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useSeededResource } from "@/lib/sync/resource";
import { useFormError } from "@/lib/useFormError";
import { ConfirmDialog, EmptyState } from "../../../../_components/ds";
import type { PipelineDealCard, PipelineView } from "../../../../_data/loaders";
import { extractMissingFields, requestStageChange } from "@/lib/crm/opportunity";
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
  /**
   * GAP-CRM-OPPORTUNITIES-02: the full pipeline list so the board can offer a
   * pipeline picker (parity with the opportunities board, which has always had
   * one). The pipeline page previously only ever rendered pipelines[0] with no
   * way to switch, hiding every other pipeline's stage layout.
   */
  pipelines?: PipelineView[];
  deals: PipelineDealCard[];
  source: "api" | "error";
};

type MoveError = {
  dealId: string;
  message: string;
};

type StageLike = { id: string; name: string; probability: number; ordinal: number };

type PendingMove = {
  deal: PipelineDealCard;
  targetStage: StageLike;
  /** Whether to overwrite the deal's own probability with the stage default. */
  acceptStageProbability: boolean;
};

export function KanbanBoard({ pipeline, pipelines, deals: serverDeals, source }: Props) {
  const t = useTranslations("crmKanbanBoard");
  const { data: deals, fromCache, offline, cachedAt } = useSeededResource<PipelineDealCard[]>(
    "crm.pipeline.deals",
    serverDeals,
    source,
    (d) => d.length === 0,
  );

  // GAP-CRM-OPPORTUNITIES-02: offer a pipeline picker when more than one pipeline
  // exists. Selecting one swaps the stage columns to that pipeline's stages; the
  // default is the pipeline passed by the server (pipelines[0]).
  const pipelineList = pipelines ?? (pipeline ? [pipeline] : []);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(pipeline?.id ?? "");
  const activePipeline = pipelineList.find((p) => p.id === selectedPipelineId) ?? pipeline;
  // GAP-CRM-PIPELINE-05: selecting a pipeline also drives a server refetch scoped
  // to it (?pipelineId=…), so the board and the "N of M" total reflect THAT
  // pipeline's full deal set — not only client-side stage filtering of the first
  // page. Local state still updates immediately for responsiveness.
  const router = useRouter();
  const searchParams = useSearchParams();
  const onSelectPipeline = useCallback(
    (id: string) => {
      setSelectedPipelineId(id);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (id) params.set("pipelineId", id);
      else params.delete("pipelineId");
      const qs = params.toString();
      router.push(qs ? `/crm/pipeline?${qs}` : "/crm/pipeline");
    },
    [router, searchParams],
  );

  const stages = activePipeline?.stages ?? DEFAULT_STAGES;
  // True only when these are real crm.pipeline_stages rows (uuid ids) — see the
  // DEFAULT_STAGES doc comment above for why that distinction matters on PATCH.
  const hasRealPipeline = Boolean(activePipeline?.stages && activePipeline.stages.length > 0);
  const [localDeals, setLocalDeals] = useState<PipelineDealCard[]>(deals);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [dropTargetStage, setDropTargetStage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<MoveError | null>(null);
  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const announcerRef = useRef<HTMLDivElement>(null);
  const formError = useFormError("deal");

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
      announce(t("announcePickedUp", { name: deal.name }));
    }
  }, [localDeals, announce, t]);

  const handleDragOver = useCallback((stageId: string) => {
    setDropTargetStage(stageId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetStage(null);
  }, []);

  // GAP-CRM-PIPELINE-02: a drop/keyboard move no longer PATCHes immediately. It opens a
  // ConfirmDialog first (parity with /crm/opportunities, which already confirms the move
  // and shows the stage change) and only commits on confirm. No optimistic update and no
  // network call happen until then, so a cancel leaves the card exactly where it was.
  const requestMove = useCallback((dealId: string, targetStageId: string) => {
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal) return;
    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!targetStage) return;
    // Same-stage drop is a no-op — never prompt for it.
    if (deal.stageId === targetStageId || deal.stage === targetStage.name) return;
    setMoveError(null);
    setPendingMove({
      deal,
      targetStage,
      // Default: only adopt the stage's probability when the deal has none of its own
      // (0/unset). A deal that already carries a probability keeps it unless the user
      // ticks "use the stage's default probability" in the dialog — we never silently
      // overwrite a hand-set probability with the stage default.
      acceptStageProbability: !deal.probability,
    });
  }, [localDeals, stages]);

  const commitMove = useCallback(async (move: PendingMove) => {
    const { deal, targetStage, acceptStageProbability } = move;
    setConfirmBusy(true);
    setMovingDealId(deal.id);
    const previousDeals = [...localDeals];
    // Only change probability optimistically when we're actually going to send it.
    const sendProbability = acceptStageProbability;
    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === deal.id
          ? { ...d, stageId: targetStage.id, stage: targetStage.name, probability: sendProbability ? targetStage.probability : d.probability }
          : d,
      ),
    );

    try {
      // GAP-CRM-OPPORTUNITIES-02: same client function + payload as the
      // opportunity list views (lib/crm/opportunity requestStageChange).
      const res = await requestStageChange(deal.id, {
        stage: targetStage.name,
        // Only a real pipeline's stages have a uuid id — DEFAULT_STAGES' ids
        // ("lead", "proposal", ...) are synthetic and would fail the backend's
        // z.string().uuid() check. Move-by-name alone still works.
        ...(hasRealPipeline ? { stageId: targetStage.id } : {}),
        // GAP-CRM-PIPELINE-02: probability is sent ONLY when the user accepted the
        // stage default; otherwise it is omitted so the backend keeps the deal's own.
        ...(sendProbability ? { probability: targetStage.probability } : {}),
        version: deal.version,
      });

      if (!res.ok) {
        setLocalDeals(previousDeals);
        let missing: string[] = [];
        if (res.status === 422) {
          try {
            missing = extractMissingFields(await res.clone().json());
          } catch {
            missing = [];
          }
        }
        if (res.status === 409) {
          setMoveError({
            dealId: deal.id,
            message: t("versionConflict"),
          });
          announce(t("announceVersionConflict", { name: deal.name }));
        } else if (missing.length > 0) {
          // GAP-CRM-OPPORTUNITIES-02: the drag path now handles the OP-003
          // mandatory-field gate like the list views do, naming the fields.
          const message = t("missingFields", { fields: missing.join(", ") });
          setMoveError({ dealId: deal.id, message });
          announce(t("announceMoveFailed", { name: deal.name, message }));
        } else {
          const resolved = await formError.fromResponse(res, "save");
          setMoveError({ dealId: deal.id, message: resolved.message });
          announce(t("announceMoveFailed", { name: deal.name, message: resolved.message }));
        }
      } else {
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === deal.id ? { ...d, version: d.version + 1 } : d,
          ),
        );
        announce(t("announceMoved", { name: deal.name, stage: targetStage.name }));
        setMoveError(null);
      }
    } catch {
      setLocalDeals(previousDeals);
      setMoveError({ dealId: deal.id, message: t("networkError") });
      announce(t("announceNetworkError", { name: deal.name }));
    } finally {
      setMovingDealId(null);
      setConfirmBusy(false);
      setPendingMove(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [localDeals, hasRealPipeline, announce, t]);

  const handleDrop = useCallback((targetStageId: string) => {
    if (!draggedDealId) return;
    setDraggedDealId(null);
    setDropTargetStage(null);
    requestMove(draggedDealId, targetStageId);
  }, [draggedDealId, requestMove]);

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
      announce(t(direction === "left" ? "cannotMoveLeft" : "cannotMoveRight", { name: deal.name }));
      return;
    }

    const targetStage = stages[newIdx];
    requestMove(dealId, targetStage.id);
  }, [localDeals, stages, requestMove, announce, t]);

  const cacheNote =
    offline || fromCache
      ? t("cacheNote", {
          hasDate: cachedAt ? "yes" : "no",
          date: cachedAt ? new Date(cachedAt).toLocaleString("en-IN") : "",
          isOffline: offline ? "yes" : "no",
        })
      : null;

  // GAP-CRM-PIPELINE-01: an outage must not read as "an empty pipeline". When the load
  // errored AND there is nothing cached to fall back on, show an error state with a
  // Retry — never the empty state (which fabricates "empty" as fact). A cached copy
  // (fromCache/offline) still renders the board below, with the cacheNote banner, so
  // going offline is not treated as an error.
  // GAP-CRM-PIPELINE-04: user-visible copy says "engagement(s)" throughout, matching the
  // screen header/cards and the /crm/deals vocabulary (decision: standardise on
  // "Engagement" to avoid a new split with the deals list, which also uses it).
  if (localDeals.length === 0 && source === "error" && !fromCache && !offline) {
    return (
      <div className="card">
        <EmptyState
          icon="⚠️"
          title={t("loadErrorTitle")}
          message={t("loadErrorMessage")}
          action={
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              {t("retry")}
            </button>
          }
        />
      </div>
    );
  }

  if (localDeals.length === 0 && stages.length > 0) {
    return (
      <div className="card">
        <EmptyState
          icon="📊"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
          action={<a href="/crm/deals/new" className="btn primary">{t("newEngagement")}</a>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pipelineList.length > 1 && (
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          {t("pipeline")}
          <select
            aria-label={t("pipeline")}
            value={selectedPipelineId}
            onChange={(e) => onSelectPipeline(e.target.value)}
            style={{ padding: 6, borderRadius: 8, border: "1px solid var(--line)" }}
          >
            {pipelineList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

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
            {t("dismiss")}
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
        aria-label={t("stagesAriaLabel")}
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

      {/* GAP-CRM-PIPELINE-02: confirm a stage move before it is committed. No PATCH is
          issued until the user confirms; cancelling leaves the card where it was. When
          the deal already has its own probability and the target stage has a different
          default, offer a checkbox to adopt the stage default — otherwise the deal keeps
          its probability. */}
      <ConfirmDialog
        open={pendingMove !== null}
        title={
          pendingMove
            ? t("moveTitle", { name: pendingMove.deal.name, stage: pendingMove.targetStage.name })
            : ""
        }
        description={
          pendingMove ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0 }}>
                {t.rich("moveDescription", {
                  stage: pendingMove.targetStage.name,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              {pendingMove.deal.probability && pendingMove.deal.probability !== pendingMove.targetStage.probability ? (
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={pendingMove.acceptStageProbability}
                    onChange={(e) =>
                      setPendingMove((m) => (m ? { ...m, acceptStageProbability: e.target.checked } : m))
                    }
                  />
                  {t("replaceProbability", {
                    current: pendingMove.deal.probability,
                    stageDefault: pendingMove.targetStage.probability,
                  })}
                </label>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel={t("moveConfirm")}
        busy={confirmBusy}
        onCancel={() => {
          setPendingMove(null);
          announce(t("moveCancelled"));
        }}
        onConfirm={() => pendingMove && void commitMove(pendingMove)}
      />
    </div>
  );
}
