"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog, useConfirmAction } from "../../../../_components/ds";

type Panel = "brief" | "affidavit" | null;

/**
 * Case-detail header actions.
 *
 *  - "Brief counsel"   → POST /api/v1/legal/counsel-briefs (services/legal-service/src/modules/counsel)
 *    This is a real, fully-built endpoint (routes + commands + queue consumer + repo) that this
 *    button previously did not call: it silently recorded a generic case reminder instead ("Brief
 *    counsel: <note>"), which never created a counsel_brief record, so nothing about who was
 *    briefed, their fee, or brief status (assigned/accepted/completed/withdrawn) was ever tracked.
 *    Fixed to call the real endpoint. The endpoint has no due-date field, so an optional "brief by"
 *    date is folded into the summary text rather than silently dropped.
 *  - "Upload Affidavit"→ POST /api/v1/legal/cases/:id/orders (records the affidavit as a case filing)
 *    legal-service does have a real document-management module (modules/documents), but it is keyed
 *    by matterId, a concept the cases module has no relationship to (cases carry no matterId
 *    anywhere in the schema) — wiring this to real document storage is a data-model change, not a
 *    UI fix, so this workaround stays as-is. Recording an affidavit is an irreversible case filing,
 *    so it is gated behind an accessible ConfirmDialog (maker-checker).
 * "Legal opinion →" remains a plain navigation link.
 */
export function CaseActions({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // brief counsel fields
  const [counselName, setCounselName] = useState("");
  const [counselType, setCounselType] = useState("advocate");
  const [briefDate, setBriefDate] = useState("");
  const [briefMessage, setBriefMessage] = useState("");
  // affidavit fields
  const [affidavitDate, setAffidavitDate] = useState("");
  const [affidavitSummary, setAffidavitSummary] = useState("");

  const close = useCallback(() => {
    setPanel(null);
    setMessage("");
  }, []);

  useEffect(() => {
    if (!panel) return;
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, close]);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text || `Request failed (${res.status})`);
        return false;
      }
      close();
      router.refresh();
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Affidavit recording is irreversible — gate it behind a ConfirmDialog.
  const affidavitConfirm = useConfirmAction({
    onConfirm: async () => {
      const res = await fetch(`/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderType: "affidavit",
          summary: affidavitSummary.trim(),
          orderDate: affidavitDate,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
    },
    onSuccess: () => {
      close();
      router.refresh();
    },
  });

  function submitBrief(e: React.FormEvent) {
    e.preventDefault();
    if (counselName.trim().length < 1) {
      setMessage("Counsel name is required.");
      return;
    }
    if (briefMessage.trim().length < 1) {
      setMessage("Briefing note is required.");
      return;
    }
    const briefSummary = (briefDate ? `Brief by ${briefDate}. ` : "") + briefMessage.trim();
    void post(`/api/proxy/v1/legal/counsel-briefs`, {
      caseId,
      // Defensive caps matching the backend's zod bounds (validators.ts:
      // counselName max 256, briefSummary max 8000) — the HTML maxLength on
      // the input covers normal typing, but paste/IME/programmatic input can
      // bypass it, and an oversized value should be trimmed client-side
      // rather than round-tripped to a 400 that drops the whole submission.
      counselName: counselName.trim().slice(0, 256),
      counselType,
      briefSummary: briefSummary.slice(0, 8000),
    });
  }

  function submitAffidavit(e: React.FormEvent) {
    e.preventDefault();
    if (affidavitSummary.trim().length < 1 || !affidavitDate) {
      setMessage("Affidavit description and filing date are required.");
      return;
    }
    setMessage("");
    affidavitConfirm.trigger();
  }

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setPanel("brief")}>Brief counsel</button>
      <Link href="/legal/opinions" className="btn ghost">Legal opinion →</Link>
      <button type="button" className="btn primary" onClick={() => setPanel("affidavit")}>Upload Affidavit</button>

      {panel && (
        <div
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-action-title"
            className="card"
            style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto" }}
          >
            <div className="card-h">
              <h3 id="case-action-title">{panel === "brief" ? "Brief counsel" : "Upload affidavit"}</h3>
              <button type="button" className="btn ghost" onClick={close} aria-label="Close dialog">✕</button>
            </div>

            {panel === "brief" ? (
              <form className="pad" onSubmit={submitBrief} noValidate>
                <label className="label" htmlFor="counselName">Counsel name *</label>
                <input
                  id="counselName"
                  ref={firstFieldRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  className="inp"
                  value={counselName}
                  onChange={(e) => setCounselName(e.target.value)}
                  required
                  maxLength={256}
                  style={{ width: "100%", minHeight: 44, marginBottom: 10 }}
                />
                <label className="label" htmlFor="counselType">Counsel type</label>
                <select
                  id="counselType"
                  className="inp"
                  value={counselType}
                  onChange={(e) => setCounselType(e.target.value)}
                  style={{ width: "100%", minHeight: 44, marginBottom: 10 }}
                >
                  <option value="advocate">Advocate</option>
                  <option value="senior_advocate">Senior advocate</option>
                  <option value="counsel">Counsel</option>
                  <option value="law_officer">Law officer</option>
                </select>
                <label className="label" htmlFor="briefMessage">Briefing note *</label>
                <textarea
                  id="briefMessage"
                  className="inp"
                  rows={3}
                  value={briefMessage}
                  onChange={(e) => setBriefMessage(e.target.value)}
                  required
                  style={{ width: "100%", marginBottom: 10 }}
                />
                <label className="label" htmlFor="briefDate">Brief by date</label>
                <input id="briefDate" type="date" className="inp" value={briefDate} onChange={(e) => setBriefDate(e.target.value)} style={{ width: "100%", minHeight: 44 }} />
                <DialogFooter busy={busy} onCancel={close} submitLabel="Brief counsel" />
                <Status message={message} />
              </form>
            ) : (
              <form className="pad" onSubmit={submitAffidavit} noValidate>
                <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 12px" }}>
                  Recorded as a case filing (no file-upload endpoint in legal-service).
                </p>
                <label className="label" htmlFor="affidavitSummary">Affidavit description *</label>
                <textarea
                  id="affidavitSummary"
                  ref={firstFieldRef as React.RefObject<HTMLTextAreaElement>}
                  className="inp"
                  rows={3}
                  value={affidavitSummary}
                  onChange={(e) => setAffidavitSummary(e.target.value)}
                  required
                  maxLength={2000}
                  style={{ width: "100%", marginBottom: 10 }}
                />
                <label className="label" htmlFor="affidavitDate">Filing date *</label>
                <input id="affidavitDate" type="date" className="inp" value={affidavitDate} onChange={(e) => setAffidavitDate(e.target.value)} required style={{ width: "100%", minHeight: 44 }} />
                <DialogFooter busy={affidavitConfirm.busy} onCancel={close} submitLabel="Record affidavit" />
                <Status message={message} />
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={affidavitConfirm.open}
        title="Record this affidavit?"
        description="This files the affidavit against the case record and cannot be undone. Confirm the description and filing date are correct."
        confirmLabel="Record affidavit"
        busy={affidavitConfirm.busy}
        errorMessage={affidavitConfirm.error}
        onConfirm={() => affidavitConfirm.confirm()}
        onCancel={affidavitConfirm.cancel}
      />
    </>
  );
}

function DialogFooter({ busy, onCancel, submitLabel }: { busy: boolean; onCancel: () => void; submitLabel: string }) {
  return (
    <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
      <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
      <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  );
}

function Status({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite">
      {message ? <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>{message}</p> : null}
    </div>
  );
}
