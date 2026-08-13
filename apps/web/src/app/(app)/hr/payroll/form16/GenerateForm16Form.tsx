"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog, StatusPill, Segmented } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type Mode = "single" | "bulk";

const MODE_LABEL: Record<Mode, string> = {
  single: "Single employee",
  bulk: "Whole run (bulk)",
};
const LABEL_MODE: Record<string, Mode> = {
  "Single employee": "single",
  "Whole run (bulk)": "bulk",
};

type BulkGenerateResponse = {
  data: { jobId: string; fy: string; message: string };
};

type BulkStatusResponse = {
  data: {
    jobId: string;
    fy: string;
    status: "pending" | "processing" | "completed" | "failed";
    totalEmployees: number;
    generated: number;
    failed: number;
  };
};

const FY_RE = /^\d{4}-\d{2}$/;
const TERMINAL = new Set(["completed", "failed"]);

export function GenerateForm16Form({ defaultFy }: { defaultFy: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("single");
  const [fy, setFy] = useState(defaultFy);
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [validationError, setValidationError] = useState<string | null>(null);
  const [job, setJob] = useState<BulkStatusResponse["data"] | null>(null);
  const [polling, setPolling] = useState(false);

  const fyId = useId();
  const empId = useId();
  const errId = useId();
  const fyRef = useRef<HTMLInputElement>(null);
  const empRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollOnce = useCallback(async (pollFy: string) => {
    try {
      const res = await browserJson<BulkStatusResponse>(
        `v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(pollFy)}`,
      );
      setJob(res.data);
      if (TERMINAL.has(res.data.status)) {
        stopPolling();
        router.refresh();
      }
    } catch {
      // transient network error — keep polling, the terminal-state timeout below stops it
    }
  }, [router, stopPolling]);

  const startPolling = useCallback((pollFy: string) => {
    stopPolling();
    setPolling(true);
    void pollOnce(pollFy);
    pollRef.current = setInterval(() => void pollOnce(pollFy), 3000);
    window.setTimeout(() => stopPolling(), 5 * 60_000);
  }, [pollOnce, stopPolling]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    if (!FY_RE.test(fy)) {
      setValidationError("Financial year must be in format YYYY-YY, e.g. 2025-26.");
      fyRef.current?.focus();
      return;
    }
    if (mode === "single" && !employeeId.trim()) {
      setValidationError("Employee ID is required to generate a single Form-16.");
      empRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function generate() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<BulkGenerateResponse>("v1/payroll/tax/form16/bulk-generate", {
        method: "POST",
        body: JSON.stringify({
          fy,
          employeeIds: mode === "single" ? [employeeId.trim()] : null,
        }),
      });
      setConfirmOpen(false);
      setJob({ jobId: res.data.jobId, fy: res.data.fy, status: "pending", totalEmployees: 0, generated: 0, failed: 0 });
      // Client-side polling (below) keeps this card live; router.push separately
      // re-navigates to ?fy=<res.data.fy> so the server-rendered "Bulk Filing Run"
      // card downstream also reflects the new job on its own next fetch/refresh —
      // the two update paths are intentionally independent (poll owns this card,
      // the server component owns the one below it).
      startPolling(res.data.fy);
      router.push(`/hr/payroll/form16?fy=${encodeURIComponent(res.data.fy)}`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Generate Form-16" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, padding: 0 }}>Scope</legend>
            <Segmented
              options={["Single employee", "Whole run (bulk)"]}
              value={MODE_LABEL[mode]}
              onChange={(v) => {
                setMode(LABEL_MODE[v] ?? "single");
                setValidationError(null);
              }}
            />
          </fieldset>

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                ref={fyRef}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder="2025-26"
                aria-required="true"
                aria-invalid={validationError?.startsWith("Financial year") || undefined}
                aria-describedby={validationError?.startsWith("Financial year") ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            {mode === "single" && (
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <input
                  id={empId}
                  ref={empRef}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="Employee UUID (see HR / Employees)"
                  aria-required="true"
                  aria-invalid={validationError?.startsWith("Employee ID") || undefined}
                  aria-describedby={validationError?.startsWith("Employee ID") ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
            )}
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              {mode === "single" ? "Generate Form-16" : "Generate Form-16 for whole run"}
            </button>
          </div>

          {validationError && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
              {validationError}
            </p>
          )}

          {job && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }} role="status" aria-live="polite">
              <span><strong>Job:</strong> <span className="mono">{job.jobId}</span></span>
              <StatusPill status={job.status} />
              {polling && <span style={{ color: "var(--mut)" }}>Checking progress…</span>}
              {job.status === "completed" && (
                <span style={{ color: "var(--good)" }}>
                  {job.generated} generated{job.failed > 0 ? `, ${job.failed} failed` : ""}.
                </span>
              )}
              {job.status === "failed" && <span style={{ color: "var(--bad)" }}>Job failed — see run status below.</span>}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={mode === "single" ? "Generate this employee's Form-16?" : "Generate Form-16 for the whole run?"}
        confirmLabel="Generate"
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          mode === "single" ? (
            <>
              This issues a statutory Form-16 (DSC-signed where configured) for employee{" "}
              <strong className="mono">{employeeId}</strong>, FY <strong>{fy}</strong>. This is a filing
              artifact and cannot be un-issued.
            </>
          ) : (
            <>
              This queues Form-16 generation for <strong>every employee</strong> in FY <strong>{fy}</strong>.
              It runs asynchronously and may take time to complete. Filing artifacts cannot be un-issued.
            </>
          )
        }
        onConfirm={() => void generate()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
