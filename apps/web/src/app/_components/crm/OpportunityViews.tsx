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
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Tabs } from "../ds";
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

interface PendingMove {
  deal: Opportunity;
  toStage: string;
  toStageName: string;
}

export function OpportunityViews() {
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

  const reload = useCallback(async () => {
    if (!pipelineId) return;
    if (view === "Board") {
      const { data, source } = await getKanban(pipelineId);
      setKanban(data);
      setKanbanSource(source);
    } else if (view === "List") {
      const { data, source } = await getOpportunities(pipelineId);
      setList(data);
      setListSource(source);
    } else if (view === "Calendar") {
      const { data, source } = await getCalendar(pipelineId);
      setCalendar(data);
      setCalendarSource(source);
    } else {
      const { data, source } = await getFunnel(pipelineId);
      setFunnel(data);
      setFunnelSource(source);
    }
  }, [pipelineId, view]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedPipeline = useMemo(() => pipelines.find((p) => p.id === pipelineId) ?? null, [pipelines, pipelineId]);

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
      await changeOpportunityStage(pendingMove.deal.id, pendingMove.toStage, version);
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
          <EmptyState icon="🗂️" title="—" message="The board could not be loaded just now." />
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
                                setPendingMove({ deal: d, toStage: to.key, toStageName: to.name });
                              }
                            }}
                            style={{ padding: 4, borderRadius: 6, border: "1px solid var(--line)" }}
                          >
                            {selectedPipeline.stages.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.name}
                              </option>
                            ))}
                          </select>
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
          <EmptyState icon="📋" title="—" message="The list could not be loaded just now." />
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
                    ) : (
                      <button type="button" className="btn ghost sm" onClick={() => setCloseTarget(d)}>
                        Close
                      </button>
                    )}
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
          <EmptyState icon="📅" title="—" message="The calendar could not be loaded just now." />
        ) : calendar.length === 0 ? (
          <EmptyState icon="📅" title="No close dates" message="No opportunities have an expected close date." />
        ) : (
          <div style={{ padding: 12, display: "grid", gap: 6 }}>
            {calendar
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
          <EmptyState icon="📊" title="—" message="The funnel could not be loaded just now." />
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
