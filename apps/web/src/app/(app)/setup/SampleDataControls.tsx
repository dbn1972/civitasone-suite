"use client";

import { useState } from "react";
import { Card, ConfirmDialog } from "../../_components/ds";

/**
 * SampleDataControls — let a new office switch on safe example records to explore
 * and learn, then clear them in one action. Requirement 15.
 *
 * Seeds BOTH offices (locations) and bills (finance) in one click. Clearing
 * removes only sample records — real records the clerk created are kept. The
 * backend endpoints are tenant-scoped.
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
      const [locRes, finRes] = await Promise.all([
        fetch("/api/proxy/v1/locations/sample-data", { method: "POST" }),
        fetch("/api/proxy/v1/finance/bills/sample-data", { method: "POST" }),
      ]);
      if (!locRes.ok && !finRes.ok) throw new Error();
      setMessage({ tone: "ok", text: "Example offices and bills added. Look for the \u201c[SAMPLE]\u201d label on them as you explore." });
    } catch {
      setMessage({ tone: "err", text: "We couldn\u2019t add example records just now. Please try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  async function clearSamples() {
    setBusy("clear");
    setClearError(undefined);
    try {
      const [locRes, finRes] = await Promise.all([
        fetch("/api/proxy/v1/locations/sample-data", { method: "DELETE" }),
        fetch("/api/proxy/v1/finance/bills/sample-data", { method: "DELETE" }),
      ]);
      if (!locRes.ok && !finRes.ok) throw new Error();
      setConfirmOpen(false);
      setMessage({ tone: "ok", text: "Example records removed. Anything you created yourself is untouched." });
    } catch {
      // R15.6 \u2014 keep the dialog open and tell the clerk plainly; offer retry.
      setClearError("We couldn\u2019t remove the example records. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padding>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Want to try it first?</h3>
      <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 13.5 }}>
        Add a few safe example offices and bills to explore how things work. They&apos;re clearly
        marked &ldquo;[SAMPLE]&rdquo;, and you can clear them in one click &mdash; your own records
        are never touched.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn primary" onClick={addSamples} disabled={busy !== null} aria-busy={busy === "add"}>
          {busy === "add" ? "Adding\u2026" : "Add example records"}
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
              This removes only the records marked <strong>&ldquo;[SAMPLE]&rdquo;</strong> from your office
              (offices and bills).
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
