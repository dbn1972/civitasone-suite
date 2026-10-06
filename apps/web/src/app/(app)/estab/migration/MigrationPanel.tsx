"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button, DataTable, StatusPill, ErrorState } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { toHumanError } from "@/lib/messages";

type MigrationRow = {
  id: string;
  legacyFileNo: string;
  subject: string;
  dept: string;
  pageCount: number;
  scanRef: string | null;
  efileId: string | null;
  status: string;
  createdAt: string;
};

const EMPTY = { legacyFileNo: "", subject: "", dept: "", pageCount: "0", scanRef: "" };

// GAP-ESTAB-MIGRATION-05: zod schema for client validation with per-field errors.
const registerSchema = z.object({
  legacyFileNo: z.string().min(1, "Legacy file number is required."),
  dept: z.string().min(1, "Department is required."),
  subject: z.string().min(3, "Subject must be at least 3 characters."),
  pageCount: z.number().int("Must be a whole number.").nonnegative("Pages cannot be negative."),
  scanRef: z.string().optional(),
});

export function MigrationPanel() {
  const [rows, setRows] = useState<MigrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fldLegacyId = useId();
  const fldDeptId = useId();
  const fldSubjectId = useId();
  const fldPagesId = useId();
  const fldScanId = useId();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      // GAP-ESTAB-MIGRATION-06: use browserJson instead of raw fetch.
      const data = await browserJson<MigrationRow[] | { data?: MigrationRow[] }>(
        "v1/estab/migration?limit=100",
        { signal },
      );
      setRows(Array.isArray(data) ? data : (data?.data ?? []));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const register = useCallback(async () => {
    setSaving(true);
    setMessage("");
    setSaveError("");
    setFieldErrors({});

    // GAP-ESTAB-MIGRATION-05: zod-based per-field validation.
    const parsed = registerSchema.safeParse({
      legacyFileNo: form.legacyFileNo.trim(),
      dept: form.dept.trim(),
      subject: form.subject.trim(),
      pageCount: Number(form.pageCount) || 0,
      scanRef: form.scanRef.trim() || undefined,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as string;
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      setSaving(false);
      // Focus first invalid field.
      const firstKey = Object.keys(errs)[0];
      const map: Record<string, string> = {
        legacyFileNo: fldLegacyId,
        dept: fldDeptId,
        subject: fldSubjectId,
        pageCount: fldPagesId,
      };
      if (firstKey && map[firstKey]) {
        document.getElementById(map[firstKey])?.focus();
      }
      return;
    }

    try {
      // GAP-ESTAB-MIGRATION-06: use browserJson instead of raw fetch.
      await browserJson("v1/estab/migration", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setMessage("Legacy file registered.");
      setForm({ ...EMPTY });
      setFieldErrors({});
      setTimeout(() => void load(), 800);
    } catch (err) {
      // GAP-ESTAB-MIGRATION-02: never expose raw server body (browserJson
      // uses userFacingErrorFromResponse internally via browserFetch).
      setSaveError(err instanceof Error ? err.message : "Could not register. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [form, load, fldLegacyId, fldDeptId, fldSubjectId, fldPagesId]);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      {/* GAP-ESTAB-MIGRATION-02: status messages — success and save error only
          (load error is handled by ErrorState in the register card below). */}
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {saveError ? <p role="alert" style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{saveError}</p> : null}
      </div>

      <div className="card">
        <div className="card-h"><h3>Register a legacy file</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          {/* GAP-ESTAB-MIGRATION-05: required markers, aria-required, per-field errors */}
          <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <label htmlFor={fldLegacyId}>Legacy file no <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span></label>
            <input id={fldLegacyId} value={form.legacyFileNo}
              onChange={(e) => setForm((f) => ({ ...f, legacyFileNo: e.target.value }))}
              aria-required="true" aria-invalid={!!fieldErrors.legacyFileNo || undefined}
              aria-describedby={fieldErrors.legacyFileNo ? `${fldLegacyId}-err` : undefined}
            />
            {fieldErrors.legacyFileNo && <p id={`${fldLegacyId}-err`} role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad)" }}>{fieldErrors.legacyFileNo}</p>}
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <label htmlFor={fldDeptId}>Department <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span></label>
            <input id={fldDeptId} value={form.dept}
              onChange={(e) => setForm((f) => ({ ...f, dept: e.target.value }))}
              aria-required="true" aria-invalid={!!fieldErrors.dept || undefined}
              aria-describedby={fieldErrors.dept ? `${fldDeptId}-err` : undefined}
            />
            {fieldErrors.dept && <p id={`${fldDeptId}-err`} role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad)" }}>{fieldErrors.dept}</p>}
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <label htmlFor={fldPagesId}>Pages</label>
            <input id={fldPagesId} type="number" min={0} step={1} inputMode="numeric"
              value={form.pageCount}
              onChange={(e) => setForm((f) => ({ ...f, pageCount: e.target.value }))}
              aria-invalid={!!fieldErrors.pageCount || undefined}
              aria-describedby={fieldErrors.pageCount ? `${fldPagesId}-err` : undefined}
            />
            {fieldErrors.pageCount && <p id={`${fldPagesId}-err`} role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad)" }}>{fieldErrors.pageCount}</p>}
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <label htmlFor={fldScanId}>Scan reference (optional)</label>
            <input id={fldScanId} value={form.scanRef} placeholder="storage key / URL"
              onChange={(e) => setForm((f) => ({ ...f, scanRef: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gap: 4, fontSize: "0.8125rem", gridColumn: "1 / -1" }}>
            <label htmlFor={fldSubjectId}>Subject <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span></label>
            <input id={fldSubjectId} value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              aria-required="true" aria-invalid={!!fieldErrors.subject || undefined}
              aria-describedby={fieldErrors.subject ? `${fldSubjectId}-err` : undefined}
            />
            {fieldErrors.subject && <p id={`${fldSubjectId}-err`} role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad)" }}>{fieldErrors.subject}</p>}
          </div>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          <Button disabled={saving} onClick={() => void register()}>
            {saving ? "Registering…" : "Register file"}
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Migration register</h3></div>
        {/* GAP-ESTAB-MIGRATION-01: on load error show ErrorState + retry,
            not the misleading "No legacy files registered yet." */}
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
        ) : loadError ? (
          <div className="pad">
            <ErrorState error={toHumanError("load", { area: "migration register" })} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "var(--mut)" }}>No legacy files registered yet.</p>
        ) : (
          <DataTable<MigrationRow>
            columns={[
              { key: "legacyFileNo", label: "Legacy No", render: (r) => <span className="mono">{r.legacyFileNo}</span> },
              { key: "subject", label: "Subject" },
              { key: "dept", label: "Dept" },
              { key: "pageCount", label: "Pages" },
              {
                key: "efileId",
                label: "eFile",
                // GAP-ESTAB-MIGRATION-06: use next/link and CSS var instead of
                // a hard-coded hex colour.
                render: (r) => r.efileId
                  ? <Link className="mono" style={{ color: "var(--accent, var(--primary))" }} href={`/estab/files/${r.efileId}`}>{r.efileId.slice(0, 8)}…</Link>
                  : <>—</>,
              },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
