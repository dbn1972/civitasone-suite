"use client";

import { useState } from "react";
import { Card, ConfirmDialog } from "../../_components/ds";

/**
 * SampleDataControls — let a new office switch on safe example records to explore
 * and learn, then clear them in one action. Requirement 15.
 *
 * - "Add example records" seeds clearly-marked sample data into this office only.
 * - "Clear example records" asks for confirmation (stating exactly what will be
 *   removed), then removes only sample records — real records the clerk created
 *   are kept. The backend endpoints are tenant-scoped.
 */
export function SampleDataControls() {
  const [busy, setBusy] = useState<null | "add" | "clear">(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [clearError, setClearError] = useState<string | undefined>();

  async function addSamples() {
    setBusy("add");
    setMessage(null);
    try {
      const res = await fetch("/api/proxy/v1/admin/sample-data", { method: "POST" });
      if (!res.ok) throw new Error();
      setMessage({ tone: "ok", text: "Example records added. Look for the “Sample” tag on them as you explore." });
    } catch {
      setMessage({ tone: "err", text: "We couldn't add example records just now. Please try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  async function clearSamples() {
    setBusy("clear");
    setClearError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/admin/sample-data", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setConfirmOpen(false);
      setMessage({ tone: "ok", text: "Example records removed. Anything you created yourself is untouched." });
    } catch {
      // R15.6 — keep the dialog open and tell the clerk plainly; offer retry.
      setClearError("We couldn't remove the example records. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padding>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Want to try it first?</h3>
      <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 13.5 }}>
        Add a few safe example records to explore how things work. They&apos;re clearly marked as
        &ldquo;Sample&rdquo;, and you can clear them in one click — your own records are never touched.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn primary" onClick={addSamples} disabled={busy !== null} aria-busy={busy === "add"}>
          {busy === "add" ? "Adding…" : "Add example records"}
        </button>
        <button type="button" className="btn ghost" onClick={() => { setClearError(undefined); setConfirmOpen(true); }} disabled={busy !== null}>
          Clear example records
        </button>
      </div>

      {message && (
        <p
          role="status"
          aria-live="polite"
          style={{
            marginTop: 12, fontSize: 13, padding: "8px 12px", borderRadius: 6,
            background: message.tone === "err" ? "#fef2f2" : "#f0fdf4",
            color: message.tone === "err" ? "#b91c1c" : "#15803d",
            border: `1px solid ${message.tone === "err" ? "#fecaca" : "#bbf7d0"}`,
          }}
        >
          {message.text}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Clear example records?"
        danger
        confirmLabel="Clear example records"
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              This removes only the records marked <strong>“Sample”</strong> from your office.
            </p>
            <p style={{ margin: 0 }}>
              Anything you created yourself will be kept. This can&apos;t be undone.
            </p>
          </>
        }
        busy={busy === "clear"}
        errorMessage={clearError}
        onConfirm={clearSamples}
        onCancel={() => { if (busy !== "clear") setConfirmOpen(false); }}
      />
    </Card>
  );
}
