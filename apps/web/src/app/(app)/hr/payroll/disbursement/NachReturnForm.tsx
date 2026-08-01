"use client";

import { useId, useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RunOption = { id: string; payPeriod: string };
type ReturnSummary = { credited: number; returned: number; unmatched: number };

export function NachReturnForm({ runs }: { runs: RunOption[] }) {
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ReturnSummary | null>(null);

  const runSelectId = useId();
  const contentId = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(null);
    if (!runId || !content.trim()) {
      setError("Select a payroll run and paste the NACH return file content.");
      return;
    }
    setConfirmOpen(true);
  }

  async function processReturn() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<{ data: ReturnSummary }>(`v1/payroll/runs/${runId}/nach-return`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setConfirmOpen(false);
      setResult(res.data);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 6, maxWidth: 320 }}>
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
              <option key={r.id} value={r.id}>{r.payPeriod}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={contentId} style={{ fontSize: 13, fontWeight: 600 }}>
            Return File Content <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <textarea
            id={contentId}
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-required="true"
            placeholder="Paste the fixed-width bank return file content here…"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontFamily: "monospace", fontSize: 12 }}
          />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || runs.length === 0}>
          Process Return File
        </button>
      </div>
      {error && !confirmOpen && (
        <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
          {error}
        </p>
      )}
      {result && (
        <p role="status" aria-live="polite" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
          Processed: {result.credited} credited, {result.returned} returned, {result.unmatched} unmatched.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Process this NACH return file?"
        danger
        confirmLabel="Process file"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This queues the return file for reconciliation against the selected run. It cannot be
            un-submitted once queued.
          </>
        }
        onConfirm={() => void processReturn()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
