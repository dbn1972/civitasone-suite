"use client";

import { useId, useState } from "react";
import { Card, DataTable, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatBps, formatMoney } from "@/lib/formatters";
import type { ForecastResult, ForecastProjection } from "./types";

const METHODS = ["moving_average", "straight_line", "seasonal_naive"] as const;
const GRANULARITIES = ["month", "fy"] as const;

export function ForecastPanel({ defaultGranularity }: { defaultGranularity: string }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]>("moving_average");
  const [granularity, setGranularity] = useState<(typeof GRANULARITIES)[number]>(
    defaultGranularity === "fy" ? "fy" : "month",
  );
  const [horizon, setHorizon] = useState("3");
  const [param, setParam] = useState("3");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const methodId = useId();
  const granularityId = useId();
  const horizonId = useId();
  const paramId = useId();
  const persistId = useId();
  const horizonErrorId = `${horizonId}-error`;
  const paramErrorId = `${paramId}-error`;
  const serverErrorId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const errors: Record<string, string> = {};
    const horizonN = Number(horizon);
    const paramN = Number(param);
    if (!Number.isInteger(horizonN) || horizonN < 1 || horizonN > 24) {
      errors.horizon = "Horizon must be a whole number between 1 and 24.";
    }
    if (!Number.isInteger(paramN) || paramN < 1 || paramN > 24) {
      errors.param = "Window/cycle length must be a whole number between 1 and 24.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const res = await browserJson<{ data: ForecastResult }>("v1/revenue/analytics/forecast", {
        method: "POST",
        body: JSON.stringify({
          method,
          granularity,
          horizon: horizonN,
          param: paramN,
          persist,
        }),
      });
      setResult(res.data);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const projectionRows: (ForecastProjection & Record<string, unknown>)[] = result
    ? result.projections.map((p) => ({ ...p }))
    : [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="Run a collection forecast" padding>
        <form onSubmit={(e) => void handleSubmit(e)} aria-label="Run a collection forecast" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={methodId} style={{ fontSize: 13, fontWeight: 600 }}>
                Method
              </label>
              <select
                id={methodId}
                value={method}
                onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={granularityId} style={{ fontSize: 13, fontWeight: 600 }}>
                Granularity
              </label>
              <select
                id={granularityId}
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as (typeof GRANULARITIES)[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="month">Monthly</option>
                <option value="fy">Financial Year</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={horizonId} style={{ fontSize: 13, fontWeight: 600 }}>
                Horizon (periods){" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={horizonId}
                type="number"
                step={1}
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.horizon || undefined}
                aria-describedby={fieldErrors.horizon ? horizonErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.horizon && (
                <p id={horizonErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.horizon}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={paramId} style={{ fontSize: 13, fontWeight: 600 }}>
                Window / cycle length{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={paramId}
                type="number"
                step={1}
                value={param}
                onChange={(e) => setParam(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.param || undefined}
                aria-describedby={fieldErrors.param ? paramErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.param && (
                <p id={paramErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.param}
                </p>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                id={persistId}
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <label htmlFor={persistId} style={{ fontSize: 13, fontWeight: 600 }}>
                Save this run
              </label>
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy}>
              {busy ? "Running…" : "Run Forecast"}
            </button>
          </div>

          {serverError && (
            <p id={serverErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
              {serverError}
            </p>
          )}
        </form>
      </Card>

      <Card title="Forecast result">
        {!result ? (
          <EmptyState
            icon="🔮"
            title="No forecast run yet"
            message="Choose a method and horizon above and run a forecast to project future collections."
          />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: "0 16px", fontSize: 13, color: "var(--ink2)" }}>
              Method <strong>{result.method.replace(/_/g, " ")}</strong> over {result.historyPeriods} history period(s),
              projecting {result.horizon} period(s) ahead. Mean absolute deviation:{" "}
              <strong>{formatMoney(result.madMinor)}</strong>. Confidence: <strong>{formatBps(result.confidenceBps)}</strong>.
              {result.runId && <> Saved as run <strong>{result.runId}</strong>.</>}
            </div>
            <DataTable<(typeof projectionRows)[number]>
              columns={[
                { key: "index", label: "Period #", align: "right" },
                { key: "lowerMinor", label: "Lower Bound", align: "right", cellType: "amount" },
                { key: "projectionMinor", label: "Projection", align: "right", cellType: "amount" },
                { key: "upperMinor", label: "Upper Bound", align: "right", cellType: "amount" },
              ]}
              rows={projectionRows}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
