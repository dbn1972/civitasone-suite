"use client";

/**
 * RunQueryForm — analytics query builder
 *
 * Loads the analytics catalog on mount, then lets users compose a query:
 *   - metric (single select)
 *   - dimensions (multi-select checkboxes, max 3)
 *   - dynamic filter rows (field + operator + value)
 *   - optional date range
 *   - result limit (default 100, max 1000)
 *
 * On submit POSTs to /api/proxy/v1/analytics/queries and shows a 202 success
 * banner, then resets the form.
 *
 * WCAG 2.2 AA: all inputs have <label htmlFor>, errors use role="alert",
 * the submit button carries aria-busy during submission.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

// ─── Catalog types ────────────────────────────────────────────────────────────

type MetricDef = { key: string; label: string; agg: string };
type DimensionDef = { key: string; label: string };
type FilterDef = { key: string; label: string; type: string };

interface Catalog {
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  filters: FilterDef[];
  operators: string[];
}

// ─── Filter row state ─────────────────────────────────────────────────────────

interface FilterRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

let _rowCounter = 0;
function newFilterRow(operators: string[], filters: FilterDef[]): FilterRow {
  return {
    id: String(++_rowCounter),
    field: filters[0]?.key ?? "",
    operator: operators[0] ?? "eq",
    value: "",
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RunQueryForm() {
  const formId = useId();

  // Catalog state
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Form field state
  const [queryName, setQueryName] = useState("");
  const [metric, setMetric] = useState("");
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(100);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Ref to success banner for focus management
  const successRef = useRef<HTMLParagraphElement>(null);

  // ── Load catalog on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      try {
        const res = await fetch("/api/proxy/v1/analytics/catalog");
        if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
        const data: Catalog = await res.json();
        if (cancelled) return;
        setCatalog(data);
        // Initialise metric to first option
        if (data.metrics.length > 0) setMetric(data.metrics[0].key);
      } catch (err) {
        if (cancelled) return;
        setCatalogError(err instanceof Error ? err.message : "Failed to load catalog.");
      }
    }

    void loadCatalog();
    return () => { cancelled = true; };
  }, []);

  // Focus success banner when it appears
  useEffect(() => {
    if (successMsg) successRef.current?.focus();
  }, [successMsg]);

  // ── Dimension toggle ───────────────────────────────────────────────────────
  const toggleDimension = useCallback((key: string) => {
    setDimensions((prev) => {
      if (prev.includes(key)) return prev.filter((d) => d !== key);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, key];
    });
  }, []);

  // ── Filter row helpers ─────────────────────────────────────────────────────
  const addFilter = useCallback(() => {
    if (!catalog) return;
    setFilterRows((prev) => [...prev, newFilterRow(catalog.operators, catalog.filters)]);
  }, [catalog]);

  const removeFilter = useCallback((id: string) => {
    setFilterRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateFilter = useCallback(
    (id: string, patch: Partial<Omit<FilterRow, "id">>) => {
      setFilterRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  // ── Reset form ─────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setQueryName("");
    setMetric(catalog?.metrics[0]?.key ?? "");
    setDimensions([]);
    setFilterRows([]);
    setDateFrom("");
    setDateTo("");
    setLimit(100);
  }, [catalog]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitError(null);
      setSuccessMsg(null);

      const trimmedName = queryName.trim();
      if (!trimmedName) {
        setSubmitError("Query name is required.");
        return;
      }
      if (!metric) {
        setSubmitError("Please select a metric.");
        return;
      }

      const body = {
        queryName: trimmedName,
        spec: {
          metric,
          dimensions,
          filters: filterRows
            .filter((r) => r.field && r.value.trim() !== "")
            .map((r) => ({ field: r.field, operator: r.operator, value: r.value.trim() })),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          limit: Math.min(Math.max(1, limit), 1000),
        },
      };

      setSubmitting(true);
      try {
        const res = await fetch("/api/proxy/v1/analytics/queries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.status !== 202) {
          let detail = "";
          try {
            const json: unknown = await res.json();
            if (typeof json === "object" && json !== null && "message" in json) {
              detail = String((json as Record<string, unknown>).message);
            }
          } catch {
            // ignore parse error
          }
          throw new Error(detail || `Unexpected response: ${res.status}`);
        }

        setSuccessMsg("Query queued — results appear in Query Results once processed.");
        resetForm();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Submission failed. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [queryName, metric, dimensions, filterRows, dateFrom, dateTo, limit, resetForm],
  );

  // ── Render: catalog loading / error states ─────────────────────────────────
  if (catalogError) {
    return (
      <div role="alert" style={{ color: "#b91c1c", padding: "12px 0", fontSize: 14 }}>
        ⚠️ Could not load query catalog: {catalogError}
      </div>
    );
  }

  if (!catalog) {
    return (
      <p aria-live="polite" style={{ color: "#64748b", fontSize: 14, padding: "12px 0" }}>
        Loading catalog…
      </p>
    );
  }

  // ── Render: form ───────────────────────────────────────────────────────────
  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      aria-label="Run a new analytics query"
      noValidate
      style={{ display: "grid", gap: 20, maxWidth: 720 }}
    >
      {/* ── Success banner ─────────────────────────────────────────────────── */}
      {successMsg && (
        <p
          ref={successRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          style={{
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 14,
            color: "#166534",
            margin: 0,
          }}
        >
          ✅ {successMsg}
        </p>
      )}

      {/* ── Error region ───────────────────────────────────────────────────── */}
      {submitError && (
        <p
          role="alert"
          style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 14,
            color: "#b91c1c",
            margin: 0,
          }}
        >
          ⚠️ {submitError}
        </p>
      )}

      {/* ── Query name ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={`${formId}-queryName`} style={labelStyle}>
          Query name <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          id={`${formId}-queryName`}
          type="text"
          required
          value={queryName}
          onChange={(e) => setQueryName(e.target.value)}
          placeholder="e.g. Monthly expenditure by department"
          aria-required="true"
          style={inputStyle}
        />
      </div>

      {/* ── Metric ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={`${formId}-metric`} style={labelStyle}>
          Metric <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          id={`${formId}-metric`}
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          required
          aria-required="true"
          style={selectStyle}
        >
          {catalog.metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.agg})
            </option>
          ))}
        </select>
      </div>

      {/* ── Dimensions ─────────────────────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>
          Dimensions{" "}
          <span style={{ fontWeight: 400, color: "#64748b" }}>(select up to 3)</span>
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 8 }}>
          {catalog.dimensions.map((dim) => {
            const checked = dimensions.includes(dim.key);
            const disabled = !checked && dimensions.length >= 3;
            return (
              <label
                key={dim.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  color: disabled ? "#94a3b8" : "#0f172a",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleDimension(dim.key)}
                  aria-disabled={disabled}
                  style={{ cursor: disabled ? "not-allowed" : "pointer" }}
                />
                {dim.label}
              </label>
            );
          })}
        </div>
        {dimensions.length >= 3 && (
          <p style={{ fontSize: 12, color: "#b45309", margin: "6px 0 0" }}>
            Maximum of 3 dimensions selected.
          </p>
        )}
      </fieldset>

      {/* ── Dynamic filters ─────────────────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Filters</legend>

        {filterRows.length === 0 && (
          <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 10px" }}>
            No filters added. Click "+ Add Filter" to narrow results.
          </p>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          {filterRows.map((row, idx) => (
            <div
              key={row.id}
              role="group"
              aria-label={`Filter ${idx + 1}`}
              style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
            >
              {/* Field */}
              <div style={{ display: "grid", gap: 2, flex: "1 1 160px" }}>
                <label htmlFor={`${formId}-filter-field-${row.id}`} style={smallLabelStyle}>
                  Field
                </label>
                <select
                  id={`${formId}-filter-field-${row.id}`}
                  value={row.field}
                  onChange={(e) => updateFilter(row.id, { field: e.target.value })}
                  style={selectStyle}
                >
                  {catalog.filters.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Operator */}
              <div style={{ display: "grid", gap: 2, flex: "0 1 120px" }}>
                <label htmlFor={`${formId}-filter-op-${row.id}`} style={smallLabelStyle}>
                  Operator
                </label>
                <select
                  id={`${formId}-filter-op-${row.id}`}
                  value={row.operator}
                  onChange={(e) => updateFilter(row.id, { operator: e.target.value })}
                  style={selectStyle}
                >
                  {catalog.operators.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>

              {/* Value */}
              <div style={{ display: "grid", gap: 2, flex: "1 1 160px" }}>
                <label htmlFor={`${formId}-filter-val-${row.id}`} style={smallLabelStyle}>
                  Value
                </label>
                <input
                  id={`${formId}-filter-val-${row.id}`}
                  type="text"
                  value={row.value}
                  onChange={(e) => updateFilter(row.id, { value: e.target.value })}
                  placeholder="e.g. Finance"
                  style={inputStyle}
                />
              </div>

              {/* Clear */}
              <button
                type="button"
                onClick={() => removeFilter(row.id)}
                aria-label={`Remove filter ${idx + 1}`}
                style={clearBtnStyle}
              >
                Clear
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addFilter}
          style={{
            marginTop: filterRows.length > 0 ? 10 : 4,
            background: "none",
            border: "1px dashed #94a3b8",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 13,
            color: "#1d4ed8",
            cursor: "pointer",
          }}
        >
          + Add Filter
        </button>
      </fieldset>

      {/* ── Date range ─────────────────────────────────────────────────────── */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>
          Date range{" "}
          <span style={{ fontWeight: 400, color: "#64748b" }}>(optional)</span>
        </legend>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
          <div style={{ display: "grid", gap: 4, flex: "1 1 180px" }}>
            <label htmlFor={`${formId}-dateFrom`} style={labelStyle}>
              From
            </label>
            <input
              id={`${formId}-dateFrom`}
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "grid", gap: 4, flex: "1 1 180px" }}>
            <label htmlFor={`${formId}-dateTo`} style={labelStyle}>
              To
            </label>
            <input
              id={`${formId}-dateTo`}
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              style={inputStyle}
            />
          </div>
        </div>
      </fieldset>

      {/* ── Limit ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 4, maxWidth: 200 }}>
        <label htmlFor={`${formId}-limit`} style={labelStyle}>
          Result limit
        </label>
        <input
          id={`${formId}-limit`}
          type="number"
          min={1}
          max={1000}
          value={limit}
          onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
          aria-describedby={`${formId}-limit-hint`}
          style={inputStyle}
        />
        <span id={`${formId}-limit-hint`} style={{ fontSize: 12, color: "#64748b" }}>
          Maximum 1 000 rows.
        </span>
      </div>

      {/* ── Submit ─────────────────────────────────────────────────────────── */}
      <div>
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="btn primary"
          style={{ minWidth: 160 }}
        >
          {submitting ? "Queuing…" : "Run Query"}
        </button>
      </div>
    </form>
  );
}

// ─── Shared inline styles (avoids external CSS dependencies) ─────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
};

const smallLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  fontSize: 14,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  background: "#fff",
  color: "#0f172a",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "12px 16px",
  margin: 0,
};

const legendStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
  padding: "0 4px",
};

const clearBtnStyle: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 13,
  border: "1px solid #fca5a5",
  borderRadius: 6,
  background: "#fff1f2",
  color: "#b91c1c",
  cursor: "pointer",
  alignSelf: "flex-end",
  whiteSpace: "nowrap",
};
