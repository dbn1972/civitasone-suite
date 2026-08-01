"use client";

import { useId, useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";

type RunOption = { id: string; payPeriod: string; netAmount: number };

type Format = "csv" | "nach" | "apbs";

export function BankFileForm({ runs }: { runs: RunOption[] }) {
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("csv");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const runSelectId = useId();
  const formatSelectId = useId();

  const selectedRun = runs.find((r) => r.id === runId);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!runId) {
      setError("Select a payroll run first.");
      return;
    }
    setConfirmOpen(true);
  }

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/runs/${runId}/bank-file?format=${format}`, {
        method: "GET",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = (body as { error?: { code?: string; message?: string } })?.error;
        setError(code?.message ?? code?.code ?? `Bank file generation failed (${res.status}).`);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `bank_transfer_${runId}.${format === "csv" ? "csv" : "txt"}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setConfirmOpen(false);
      setMessage(`Bank file "${filename}" generated and downloaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm}>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={runSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
            Payroll Run <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <select
            id={runSelectId}
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            aria-required="true"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.payPeriod}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={formatSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
            File Format <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <select
            id={formatSelectId}
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
            aria-required="true"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          >
            <option value="csv">CSV (NEFT/RTGS)</option>
            <option value="nach">NACH</option>
            <option value="apbs">APBS</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || runs.length === 0}>
          Generate &amp; Download
        </button>
      </div>
      {error && !confirmOpen && (
        <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" aria-live="polite" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Generate this bank transfer file?"
        danger
        confirmLabel="Generate file"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This generates a {format.toUpperCase()} bank transfer file for{" "}
            <strong>{selectedRun?.payPeriod ?? "the selected run"}</strong>. The file contains beneficiary
            account numbers and IFSC codes and is downloaded to this device — handle it as sensitive
            financial data.
          </>
        }
        onConfirm={() => void generate()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
