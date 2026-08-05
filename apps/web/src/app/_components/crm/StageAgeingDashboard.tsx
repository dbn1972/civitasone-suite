"use client";
/**
 * StageAgeingDashboard — OP-005. Shows opportunities that have sat in a stage
 * longer than its configured limit (days-in-stage vs limit, worst first) and,
 * below, a CRUD editor for the per-stage day limits that drive the alert. Every
 * count/age is gated on source === "error": a failed fetch renders "—" + the
 * saved-info badge, never a fabricated "0 breaches" as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getStageAgeing,
  getStageLimits,
  createStageLimit,
  updateStageLimit,
  deleteStageLimit,
  type StageAgeingRow,
  type StageLimit,
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

export function StageAgeingDashboard() {
  const [rows, setRows] = useState<StageAgeingRow[]>([]);
  const [ageingSource, setAgeingSource] = useState<OpSource | "loading">("loading");
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [limitSource, setLimitSource] = useState<OpSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

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

  useEffect(() => {
    let live = true;
    void loadAgeing(() => live);
    void loadLimits(() => live);
    return () => {
      live = false;
    };
  }, []);

  function update(key: string, patch: Partial<LimitRow>) {
    setLimits((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addLimit() {
    setLimits((prev) => [...prev, toRow({ stage: "", limitDays: 14 })]);
  }

  function rowValid(r: LimitRow): boolean {
    return r.stage.trim().length > 0 && Number.isInteger(r.limitDays) && r.limitDays > 0;
  }

  async function saveLimit(row: LimitRow) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError("A stage limit needs a stage and a whole number of days greater than zero.");
      return;
    }
    const payload: StageLimit = {
      ...(row.id ? { id: row.id } : {}),
      ...(row.pipelineId ? { pipelineId: row.pipelineId } : {}),
      stage: row.stage.trim(),
      limitDays: row.limitDays,
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
          <EmptyState icon="⏳" title="—" message="Ageing could not be loaded. Showing saved information." />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="No breaches" message="No opportunities are past their configured stage limit." />
        ) : (
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Opportunity</th>
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
                    <td>{r.name}</td>
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
                <th>Stage</th>
                <th style={{ width: 140 }}>Limit (days)</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {limits.map((row, i) => {
                const n = i + 1;
                const busy = busyKey === row.key;
                return (
                  <tr key={row.key}>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-stage-${row.key}`}>
                        Stage for limit {n}
                      </label>
                      <input
                        id={`${headingId}-stage-${row.key}`}
                        value={row.stage}
                        aria-invalid={row.stage.trim() ? undefined : true}
                        onChange={(e) => update(row.key, { stage: e.target.value })}
                        style={inputStyle}
                        placeholder="stage key"
                      />
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
                        value={Number.isInteger(row.limitDays) ? row.limitDays : ""}
                        aria-invalid={Number.isInteger(row.limitDays) && row.limitDays > 0 ? undefined : true}
                        onChange={(e) => update(row.key, { limitDays: Number(e.target.value) })}
                        style={{ ...inputStyle, textAlign: "right" }}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn primary sm" onClick={() => void saveLimit(row)} disabled={busy}>
                          {busy ? "…" : row.id ? "Save" : "Create"}
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete limit ${n}`}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ padding: 12 }}>
          <button type="button" className="btn ghost" onClick={addLimit}>
            + Add stage limit
          </button>
        </div>
      </div>

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
