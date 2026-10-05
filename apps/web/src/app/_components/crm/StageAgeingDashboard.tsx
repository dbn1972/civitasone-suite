"use client";
/**
 * StageAgeingDashboard — OP-005. Shows opportunities that have sat in a stage
 * longer than its configured limit (days-in-stage vs limit, worst first) and,
 * below, a CRUD editor for the per-stage day limits that drive the alert. Every
 * count/age is gated on source === "error": a failed fetch renders "—" + the
 * saved-info badge, never a fabricated "0 breaches" as fact.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import {
  getStageAgeing,
  getStageLimits,
  getPipelines,
  createStageLimit,
  updateStageLimit,
  deleteStageLimit,
  type StageAgeingRow,
  type StageLimit,
  type Pipeline,
  type OpSource,
} from "@/lib/crm/opportunity";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface LimitRow extends StageLimit {
  key: string;
}
let SEQ = 0;
function toRow(l: StageLimit): LimitRow {
  return { ...l, key: l.id ?? `new-${SEQ++}` };
}

export function StageAgeingDashboard({ canConfig = true }: { canConfig?: boolean } = {}) {
  const t = useTranslations("crmStageAgeingDashboard");
  const [rows, setRows] = useState<StageAgeingRow[]>([]);
  const [ageingSource, setAgeingSource] = useState<OpSource | "loading">("loading");
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [limitSource, setLimitSource] = useState<OpSource | "loading">("loading");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  /** The stages of the pipeline a row is scoped to (empty when none chosen/loaded). */
  function stagesFor(pipelineId: string | undefined): Pipeline["stages"] {
    const p = pipelines.find((pp) => pp.id === pipelineId);
    return p?.stages ?? [];
  }
  /** A saved limit whose stage key is not in its pipeline's stage list is an orphan. */
  function isOrphan(row: LimitRow): boolean {
    if (!row.stage.trim()) return false;
    const stages = stagesFor(row.pipelineId);
    // Only flag as orphan once we actually know the pipeline's stages — a limit with no
    // pipeline scope at all (legacy rows) can't be validated against a stage list.
    if (!row.pipelineId || stages.length === 0) return false;
    return !stages.some((s) => s.key === row.stage);
  }

  async function loadAgeing(isLive: () => boolean = () => true) {
    setAgeingSource("loading");
    const { data, source } = await getStageAgeing();
    if (!isLive()) return;
    setRows(data);
    setAgeingSource(source);
  }
  async function loadLimits(isLive: () => boolean = () => true) {
    setLimitSource("loading");
    const { data, source } = await getStageLimits();
    if (!isLive()) return;
    setLimits(data.map(toRow));
    setLimitSource(source);
  }
  async function loadPipelines(isLive: () => boolean = () => true) {
    const { data } = await getPipelines();
    if (!isLive()) return;
    setPipelines(data);
  }

  useEffect(() => {
    let live = true;
    void loadAgeing(() => live);
    // Only the admin config card reads/writes stage limits; skip the fetch (which
    // would 403 for a non-admin) when the config card is hidden.
    if (canConfig) {
      void loadLimits(() => live);
      void loadPipelines(() => live);
    }
    return () => {
      live = false;
    };
  }, [canConfig]);

  function update(key: string, patch: Partial<LimitRow>) {
    setLimits((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addLimit() {
    // Default the new row to the first pipeline so the stage <select> has something to
    // offer immediately (the stage must be one of a pipeline's configured stages).
    const firstPipeline = pipelines[0]?.id;
    setLimits((prev) => [...prev, toRow({ stage: "", maxDays: 14, enabled: true, ...(firstPipeline ? { pipelineId: firstPipeline } : {}) })]);
  }

  function rowValid(r: LimitRow): boolean {
    if (!(Number.isInteger(r.maxDays) && r.maxDays > 0)) return false;
    if (!r.stage.trim()) return false;
    // A stage is only valid when it belongs to the row's chosen pipeline — a free-typed
    // key (the old behaviour) that matches no stage silently disabled the alert.
    const stages = stagesFor(r.pipelineId);
    if (!r.pipelineId || stages.length === 0) return false;
    return stages.some((s) => s.key === r.stage);
  }

  async function saveLimit(row: LimitRow) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError(t("limitInvalid"));
      return;
    }
    const payload: StageLimit = {
      ...(row.id ? { id: row.id } : {}),
      ...(row.pipelineId ? { pipelineId: row.pipelineId } : {}),
      stage: row.stage.trim(),
      maxDays: row.maxDays,
      enabled: row.enabled ?? true,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateStageLimit(row.id, payload);
      else await createStageLimit(payload);
      setMessage(`Limit for “${payload.stage}” saved.`);
      await loadLimits();
      await loadAgeing();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the stage limit.");
    } finally {
      setBusyKey(null);
    }
  }

  async function doDelete(row: LimitRow) {
    if (!row.id) {
      setLimits((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteStageLimit(row.id);
      setMessage(`Limit for “${row.stage}” deleted.`);
      setConfirmKey(null);
      await loadLimits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the stage limit.");
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = limits.find((r) => r.key === confirmKey) ?? null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ------------------------------------------------ ageing breaches -- */}
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Opportunities exceeding their stage limit</h3>
          {ageingSource === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        {ageingSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading ageing…
          </p>
        ) : ageingSource === "error" ? (
          <EmptyState
            icon="⏳"
            title={t("ageingLoadErrorTitle")}
            message={t("ageingLoadErrorMessage")}
            action={
              <Button type="button" onClick={() => void loadAgeing()}>
                {t("retry")}
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="No breaches" message="No opportunities are past their configured stage limit." />
        ) : (
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>{t("colOwner")}</th>
                <th>Stage</th>
                <th className="num">Days in stage</th>
                <th className="num">Limit</th>
                <th className="num">Over by</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => b.exceededBy - a.exceededBy)
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      {/* GAP-CRM-OPPORTUNITY-AGEING-03: link the breach to its record so a
                          manager can open it directly. The deal detail route is
                          /crm/deals/:id (as used by DealCard). */}
                      {r.id ? <Link href={`/crm/deals/${r.id}`}>{r.name}</Link> : r.name}
                    </td>
                    <td>{r.ownerName ?? "—"}</td>
                    <td>{r.stageName}</td>
                    <td className="num">{r.daysInStage}</td>
                    <td className="num">{r.limitDays}</td>
                    <td className="num" style={{ color: "#b42318", fontWeight: 600 }}>
                      +{r.exceededBy}d
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* -------------------------------------------------- limits config -- */}
      {/* GAP-CRM-OPPORTUNITY-AGEING-05: the ageing list above stays visible to every
          crm_user (managers need to chase stalled deals), but the Save/Delete limits
          config drives the alert for the whole tenant and is admin-only. The server
          remains the authority on the stage-limits write endpoints. */}
      {canConfig ? (
      <div className="card">
        <div className="card-h">
          <h3>Stage day limits</h3>
          {limitSource === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
            {error}
          </p>
        ) : null}
        {limitSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading limits…
          </p>
        ) : limits.length === 0 ? (
          <EmptyState icon="⏱️" title="No stage limits yet" message="Add a limit so opportunities that stall are flagged." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("colPipeline")}</th>
                <th>Stage</th>
                <th style={{ width: 140 }}>Limit (days)</th>
                <th style={{ width: 120 }}>{t("colEnabled")}</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {limits.map((row, i) => {
                const n = i + 1;
                const busy = busyKey === row.key;
                const stages = stagesFor(row.pipelineId);
                const orphan = isOrphan(row);
                return (
                  <tr key={row.key}>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-pipeline-${row.key}`}>
                        {t("pipelineForLimit", { n })}
                      </label>
                      <select
                        id={`${headingId}-pipeline-${row.key}`}
                        value={row.pipelineId ?? ""}
                        aria-invalid={row.pipelineId ? undefined : true}
                        onChange={(e) => update(row.key, { pipelineId: e.target.value || undefined, stage: "" })}
                        style={inputStyle}
                      >
                        <option value="">{t("selectPipeline")}</option>
                        {pipelines.map((p) => (
                          <option key={p.id ?? p.name} value={p.id ?? ""}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-stage-${row.key}`}>
                        Stage for limit {n}
                      </label>
                      <select
                        id={`${headingId}-stage-${row.key}`}
                        value={row.stage}
                        aria-invalid={row.stage.trim() && !orphan && stages.some((s) => s.key === row.stage) ? undefined : true}
                        disabled={!row.pipelineId || stages.length === 0}
                        onChange={(e) => update(row.key, { stage: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="">{row.pipelineId ? t("selectStage") : t("choosePipelineFirst")}</option>
                        {/* A saved limit whose stage no longer exists in the pipeline is
                            kept visible as a disabled, flagged option so it can still be
                            seen and deleted — it is never silently dropped. */}
                        {orphan ? (
                          <option value={row.stage} disabled>
                            {t("orphanOption", { stage: row.stage })}
                          </option>
                        ) : null}
                        {stages.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {orphan ? (
                        <p role="alert" style={{ fontSize: 11, color: "#b42318", margin: "4px 0 0" }}>
                          {t("orphanAlert")}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-days-${row.key}`}>
                        Days limit for {n}
                      </label>
                      <input
                        id={`${headingId}-days-${row.key}`}
                        type="number"
                        min={1}
                        step={1}
                        value={Number.isInteger(row.maxDays) ? row.maxDays : ""}
                        aria-invalid={Number.isInteger(row.maxDays) && row.maxDays > 0 ? undefined : true}
                        onChange={(e) => update(row.key, { maxDays: Number(e.target.value) })}
                        style={{ ...inputStyle, textAlign: "end" }}
                      />
                    </td>
                    <td>
                      {/* GAP-CRM-OPPORTUNITY-AGEING-02: a limit can be paused, not only
                          deleted. The toggle is bound to the row's `enabled` flag, which
                          the save payload already carries — so saving no longer silently
                          re-enables a server-disabled limit. */}
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={row.enabled ?? true}
                          aria-label={t("enabledForLimit", { n })}
                          onChange={(e) => update(row.key, { enabled: e.target.checked })}
                        />
                        {(row.enabled ?? true) ? t("enabled") : <span style={{ color: "var(--muted)" }}>{t("paused")}</span>}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button type="button" size="sm" onClick={() => void saveLimit(row)} disabled={busy}>
                          {busy ? "…" : row.id ? "Save" : "Create"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete limit ${n}`}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ padding: 12 }}>
          <Button type="button" variant="ghost" onClick={addLimit}>
            + Add stage limit
          </Button>
        </div>
      </div>
      ) : null}

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title={confirmRow ? `Delete limit for “${confirmRow.stage || "(unnamed)"}”?` : ""}
        description="This stage will no longer flag stalled opportunities. This cannot be undone."
        confirmLabel="Delete limit"
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void doDelete(confirmRow)}
      />
    </div>
  );
}
