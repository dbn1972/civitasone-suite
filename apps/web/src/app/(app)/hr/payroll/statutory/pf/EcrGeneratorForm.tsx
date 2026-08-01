"use client";

import { useId, useRef, useState } from "react";
import { Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function EcrGeneratorForm() {
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const monthId = useId();
  const errId = useId();
  const monthRef = useRef<HTMLInputElement>(null);
  const monthInvalid = tone === "bad" && !!message;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!MONTH_RE.test(month)) {
      setTone("bad");
      setMessage("Month is required in YYYY-MM format.");
      monthRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function generateEcr() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/statutory/ecr?month=${encodeURIComponent(month)}`);
      if (!res.ok) throw new Error(`API_ERROR: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ECR_${month.replace("-", "")}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setConfirmOpen(false);
      setTone("good");
      setMessage(`ECR file generated for ${month}.`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Generate EPFO ECR File" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6, maxWidth: 220 }}>
            <label htmlFor={monthId} style={{ fontSize: 13, fontWeight: 600 }}>
              Period (Month) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={monthId}
              ref={monthRef}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-required="true"
              aria-invalid={monthInvalid || undefined}
              aria-describedby={monthInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Generate ECR
            </button>
          </div>
          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Generate EPFO ECR file?"
        confirmLabel="Confirm & Download"
        busy={busy}
        errorMessage={dialogError}
        description={<>Generate and download the EPFO Electronic Challan cum Return for period <strong>{month}</strong>.</>}
        onConfirm={() => void generateEcr()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
