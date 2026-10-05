"use client";
/**
 * OpportunityViews — OP-004. Four read views over the pipeline's opportunities:
 * a Kanban board (move a card between stages, gated by a ConfirmDialog and the
 * OP-003 mandatory-field validation), a list, a calendar keyed on close date and
 * a funnel chart. Every view reads a dedicated endpoint and is gated on
 * source === "error": a failed fetch shows "—" + the saved-info badge, never a
 * fabricated empty board. The list also launches the OP-006 close dialog.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Tabs, Button } from "../ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { CloseOpportunityDialog } from "./CloseOpportunityDialog";
import {
  getPipelines,
  getKanban,
  getFunnel,
  getOpportunities,
  getCalendar,
  changeOpportunityStage,
  MandatoryFieldsError,
  OPP_FIELD_LABELS,
  type Pipeline,
  type KanbanColumn,
  type FunnelRow,
  type Opportunity,
  type CalendarEntry,
  type OppFieldKey,
  type OpSource,
} from "@/lib/crm/opportunity";

type View = "Board" | "List" | "Calendar" | "Funnel";
const VIEWS: View[] = ["Board", "List", "Calendar", "Funnel"];

/**
 * GAP-CRM-OPPORTUNITIES-01: terminal stage names close a deal. The backend rejects a
 * plain stage move into them (422 USE_CLOSE_ENDPOINT) — closing must go through the
 * governed /close flow (outcome + reason). Kept in sync with crm-service's
 * TERMINAL_STAGE_NAMES (deals/stage-gate.ts).
 */
const TERMINAL_STAGE_NAMES = ["Won", "Lost"];
function isTerminalStageName(name: string): boolean {
  return TERMINAL_STAGE_NAMES.includes(name);
}

interface PendingMove {
  deal: Opportunity;
  toStage: string;
  toStageName: string;
  /** Stage uuid when the pipeline provides one. */
  toStageId?: string;
}

/**
 * GAP-CRM-OPPORTUNITIES-04: a failed view used to render an EmptyState whose
 * title was the bare character "—" with no way to recover. A failure is not an
 * empty board, so show a titled error with a working Retry that re-runs the
 * same fetch (reload()) — "—" is for missing values, never a heading.
 */
function ViewError({ icon, onRetry }: { icon: string; onRetry: () => void }) {
  const t = useTranslations("crmOpportunityViews");
  return (
    <EmptyState
      icon={icon}
      title={t("loadErrorTitle")}
      message={t("loadErrorMessage")}
      action={
        <Button type="button" onClick={onRetry}>
          {t("retry")}
        </Button>
      }
    />
  );
}

export function OpportunityViews({ canClose = true }: { canClose?: boolean } = {}) {
  const t = useTranslations("crmOpportunityViews");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineSource, setPipelineSource] = useState<OpSource | "loading">("loading");
  const [pipelineId, setPipelineId] = useState("");
  const [view, setView] = useState<View>("Board");

  const [kanban, setKanban] = useState<KanbanColumn[]>([]);
  const [kanbanSource, setKanbanSource] = useState<OpSource>("api");
  const [list, setList] = useState<Opportunity[]>([]);
  const [listSource, setListSource] = useState<OpSource>("api");
  const [calendar, setCalendar] = useState<CalendarEntry[]>([]);
  const [calendarSource, setCalendarSource] = useState<OpSource>("api");
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [funnelSource, setFunnelSource] = useState<OpSource>("api");

  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState("");
  const [message, setMessage] = useState("");
  const [closeTarget, setCloseTarget] = useState<Opportunity | null>(null);
  const headingId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, source } = await getPipelines();
      if (!live) return;
      setPipelines(data);
      setPipelineSource(source);
      if (data.length > 0) setPipelineId((prev) => prev || data[0].id || "");
    })();
    return () => {
      live = false;
    };
  }, []);

  const reload = useCallback(async (isLive: () => boolean = () => true) => {
    if (!pipelineId) return;
    if (view === "Board") {
      const { data, source } = await getKanban(pipelineId);
      if (!isLive()) return;
      setKanban(data);
      setKanbanSource(source);
    } else if (view === "List") {
      const { data, source } = await getOpportunities(pipelineId);
      if (!isLive()) return;
      setList(data);
      setListSource(source);
    } else if (view === "Calendar") {
      // GAP-CRM-OPPORTUNITIES-05: the calendar is a re-slice of the board's deals
      // (grouped by close date instead of stage). If the board was already loaded
      // for this pipeline, derive the calendar from it rather than issuing a second
      // fetch of the same kanban endpoint; only fetch when we have nothing cached.
      if (kanban.length > 0 && kanbanSource === "api") {
        if (!isLive()) return;
        setCalendarSource("api");
      } else {
        const { data, source } = await getCalendar(pipelineId);
        if (!isLive()) return;
        setCalendar(data);
        setCalendarSource(source);
      }
    } else {
      const { data, source } = await getFunnel(pipelineId);
      if (!isLive()) return;
      setFunnel(data);
      setFunnelSource(source);
    }
  }, [pipelineId, view, kanban, kanbanSource]);

  useEffect(() => {
    let live = true;
    void reload(() => live);
    return () => { live = false; };
  }, [reload]);

  const selectedPipeline = useMemo(() => pipelines.find((p) => p.id === pipelineId) ?? null, [pipelines, pipelineId]);

  // GAP-CRM-OPPORTUNITIES-05: the calendar is derived from the board's deals when the
  // board has been loaded (no second fetch), otherwise from the dedicated calendar
  // fetch. A deal without an expected close date cannot be placed on a calendar, so we
  // drop it from the entries but surface how many were omitted — the empty copy no
  // longer claims that *no* deal has a close date when only some are undated.
  const { calendarEntries, undatedCount } = useMemo(() => {
    const kanbanDeals = kanban.flatMap((col) => col.deals);
    if (kanbanDeals.length > 0) {
      const dated: CalendarEntry[] = [];
      let undated = 0;
      for (const d of kanbanDeals) {
        if (d.id && d.expectedCloseDate) {
          dated.push({ id: d.id, name: d.name, expectedCloseDate: d.expectedCloseDate, valueMinor: d.valueMinor, stage: d.stage });
        } else {
          undated += 1;
        }
      }
      return { calendarEntries: dated, undatedCount: undated };
    }
    return { calendarEntries: calendar, undatedCount: 0 };
  }, [kanban, calendar]);

  async function confirmMove() {
    if (!pendingMove?.deal.id) return;
    // The stage move is optimistic-locked, so the server needs the version this
    // card was rendered from. If the payload did not carry one we stop here
    // rather than guess: sending a wrong version would either be rejected as a
    // conflict or, worse, overwrite a concurrent edit.
    const version = pendingMove.deal.version;
    if (typeof version !== "number") {
      setMoveError("This opportunity is out of date. Refresh and try the move again.");
      return;
    }
    setMoveBusy(true);
    setMoveError("");
    try {
      // GAP-CRM-OPPORTUNITIES-02: send the stage NAME (+ id) — the same
      // contract the pipeline Kanban uses; the server matches stages by name.
      await changeOpportunityStage(pendingMove.deal.id, pendingMove.toStageName, version, pendingMove.toStageId);
      setMessage(`“${pendingMove.deal.name}” moved to ${pendingMove.toStageName}.`);
      setPendingMove(null);
      await reload();
    } catch (e) {
      if (e instanceof MandatoryFieldsError) {
        setMoveError(
          `${pendingMove.toStageName} needs: ${e.missingFields.map((f) => OPP_FIELD_LABELS[f as OppFieldKey] ?? f).join(", ")}.`,
        );
      } else {
        setMoveError(e instanceof Error ? e.message : "Could not move the opportunity.");
      }
    } finally {
      setMoveBusy(false);
    }
  }

  if (pipelineSource === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading pipelines…
      </p>
    );
  }

  // Distinct from a load failure: pipelines loaded fine, there just are none
  // yet (nothing auto-seeds one). Each view below would otherwise show its own
  // "no opportunities on this pipeline" empty state, which reads as if a
  // pipeline exists and is merely empty -- misleading when none exists at all.
  if (pipelineSource === "api" && pipelines.length === 0) {
    return (
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Opportunity views</h3>
        </div>
        <EmptyState
          icon="🗂️"
          title="No pipeline configured"
          message="Opportunities are tracked on a pipeline's stages. Create one to start using the board, list, calendar and funnel views."
          action={<a href="/crm/pipelines" className="btn primary">Configure a pipeline</a>}
        />
      </div>
    );
  }

  const activeSource =
    view === "Board" ? kanbanSource : view === "List" ? listSource : view === "Calendar" ? calendarSource : funnelSource;

  return (
    <div className="card">
      <div className="card-h" style={{ gap: 12, flexWrap: "wrap" }}>
        <h3 id={headingId}>Opportunity views</h3>
        <label style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
          Pipeline
          <select aria-label="Pipeline" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} style={{ padding: 6, borderRadius: 8, border: "1px solid var(--line)" }}>
            {pipelines.length === 0 ? <option value="">No pipelines</option> : null}
            {pipelines.map((p) => (
              <option key={p.id ?? p.name} value={p.id ?? ""}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {(pipelineSource === "error" || activeSource === "error") ? <DataSourceBadge source="error" /> : null}
      </div>

      <div style={{ padding: "0 12px" }}>
        <Tabs tabs={VIEWS} active={view} onChange={(t) => setView(t as View)} />
      </div>

      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
          {message}
        </p>
      ) : null}

      {/* ---------------------------------------------------------- Board -- */}
      {view === "Board" ? (
        activeSource === "error" ? (
          <ViewError icon="🗂️" onRetry={() => void reload()} />
        ) : kanban.length === 0 ? (
          <EmptyState icon="🗂️" title="No stages to show" message="This pipeline has no opportunities yet." />
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", padding: 12 }}>
            {kanban.map((col) => (
              <div key={col.stage} style={{ minWidth: 240, flex: "0 0 240px", background: "var(--surface-2, #f8fafc)", borderRadius: 10, padding: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, padding: "4px 6px" }}>
                  {col.stageName}{" "}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>({col.deals.length})</span>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {col.deals.map((d) => (
                    <div key={d.id} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{formatMoney(d.valueMinor)} · {d.probability}%</div>
                      {selectedPipeline && selectedPipeline.stages.length > 1 ? (
                        <label style={{ fontSize: 12, display: "grid", gap: 2, marginTop: 6 }}>
                          <span className="sr-only">Move {d.name} to another stage</span>
                          <select
                            aria-label={`Move ${d.name} to stage`}
                            value={col.stage}
                            onChange={(e) => {
                              const to = selectedPipeline.stages.find((s) => s.key === e.target.value);
                              if (to && to.key !== col.stage) {
                                setMoveError("");
                                setPendingMove({ deal: d, toStage: to.key, toStageName: to.name, ...(to.id ? { toStageId: to.id } : {}) });
                              }
                            }}
                            style={{ padding: 4, borderRadius: 6, border: "1px solid var(--line)" }}
                          >
                            {/* GAP-CRM-OPPORTUNITIES-01: terminal stages (Won/Lost) are
                                NOT offered here — the backend rejects a plain stage move
                                into them (422 USE_CLOSE_ENDPOINT). Closing goes through
                                the Close dialog (below), which captures outcome + reason.
                                The current stage is always kept as an option so the
                                select has a valid selected value even when it is terminal
                                (e.g. an already-closed card still shown on the board). */}
                            {selectedPipeline.stages
                              .filter((s) => !isTerminalStageName(s.name) || s.key === col.stage)
                              .map((s) => (
                                <option key={s.key} value={s.key} disabled={isTerminalStageName(s.name)}>
                                  {s.name}
                                </option>
                              ))}
                          </select>
                          {canClose && !d.outcome && d.status !== "closed" ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setCloseTarget(d)} style={{ marginTop: 4 }}>
                              {t("close")}
                            </Button>
                          ) : null}
                        </label>
                      ) : null}
                    </div>
                  ))}
                  {col.deals.length === 0 ? <div style={{ fontSize: 12, color: "var(--muted)", padding: 6 }}>Empty</div> : null}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {/* ----------------------------------------------------------- List -- */}
      {view === "List" ? (
        activeSource === "error" ? (
          <ViewError icon="📋" onRetry={() => void reload()} />
        ) : list.length === 0 ? (
          <EmptyState icon="📋" title="No opportunities" message="Nothing on this pipeline yet." />
        ) : (
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Stage</th>
                <th className="num">Value</th>
                <th className="num">Prob.</th>
                <th>Close date</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.stage}</td>
                  <td className="num">{formatMoney(d.valueMinor)}</td>
                  <td className="num">{d.probability}%</td>
                  <td>{formatIndianDate(d.expectedCloseDate)}</td>
                  <td>
                    {d.status === "closed" || d.outcome ? (
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Closed{d.outcome ? ` · ${d.outcome}` : ""}</span>
                    ) : canClose ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCloseTarget(d)}>
                        Close
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {/* ------------------------------------------------------- Calendar -- */}
      {view === "Calendar" ? (
        activeSource === "error" ? (
          <ViewError icon="📅" onRetry={() => void reload()} />
        ) : calendarEntries.length === 0 ? (
          <EmptyState
            icon="📅"
            title={t("noCloseDatesTitle")}
            message={
              undatedCount > 0
                ? t("undatedEmptyMessage", { count: undatedCount })
                : t("noExpectedCloseDate")
            }
          />
        ) : (
          <div style={{ padding: 12, display: "grid", gap: 6 }}>
            {undatedCount > 0 ? (
              <p role="note" style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 4px" }}>
                {t("undatedNote", { count: undatedCount })}
              </p>
            ) : null}
            {calendarEntries
              .slice()
              .sort((a, b) => a.expectedCloseDate.localeCompare(b.expectedCloseDate))
              .map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
                  <span style={{ minWidth: 100, color: "var(--muted)" }}>{formatIndianDate(c.expectedCloseDate)}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span>{formatMoney(c.valueMinor)}</span>
                </div>
              ))}
          </div>
        )
      ) : null}

      {/* --------------------------------------------------------- Funnel -- */}
      {view === "Funnel" ? (
        activeSource === "error" ? (
          <ViewError icon="📊" onRetry={() => void reload()} />
        ) : funnel.length === 0 ? (
          <EmptyState icon="📊" title="No funnel data" message="No opportunities to chart." />
        ) : (
          <div style={{ padding: 12, display: "grid", gap: 8 }}>
            {(() => {
              const max = Math.max(1, ...funnel.map((f) => f.count));
              return funnel.map((f) => (
                <div key={f.stage} style={{ display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{f.stageName}</span>
                    <span style={{ color: "var(--muted)" }}>
                      {f.count} · {formatMoney(f.valueMinor)}
                    </span>
                  </div>
                  <div
                    role="meter"
                    aria-valuenow={f.count}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-label={`${f.stageName}: ${f.count} opportunities`}
                    style={{ background: "var(--surface-2, #f1f5f9)", borderRadius: 6, height: 18 }}
                  >
                    <div style={{ width: `${(f.count / max) * 100}%`, background: "#6366f1", height: "100%", borderRadius: 6, minWidth: f.count > 0 ? 4 : 0 }} />
                  </div>
                </div>
              ));
            })()}
          </div>
        )
      ) : null}

      <ConfirmDialog
        open={pendingMove !== null}
        title={pendingMove ? `Move “${pendingMove.deal.name}” to ${pendingMove.toStageName}?` : ""}
        description="The opportunity's stage will change. If the target stage needs more information, the move will be blocked."
        confirmLabel="Move"
        busy={moveBusy}
        errorMessage={moveError}
        onCancel={() => {
          setPendingMove(null);
          setMoveError("");
        }}
        onConfirm={() => void confirmMove()}
      />

      {closeTarget ? (
        <CloseOpportunityDialog
          opportunityId={closeTarget.id ?? ""}
          opportunityName={closeTarget.name}
          open={closeTarget !== null}
          onClose={() => setCloseTarget(null)}
          onClosed={() => void reload()}
        />
      ) : null}
    </div>
  );
}
