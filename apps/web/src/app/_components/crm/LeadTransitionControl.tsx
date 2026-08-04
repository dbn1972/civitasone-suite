"use client";
/**
 * LeadTransitionControl — LQ-004. Upgrades the lead status change into a
 * reason-code driven, audited transition: pick a target status, choose a reason
 * from the controlled list configured for that status, add an optional note,
 * then confirm in a ConfirmDialog. Disqualified leads get an explicit Re-open
 * action (→ new / qualified). On a failed reason-code load we show the saved-info
 * badge and never fabricate an empty list as fact.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog } from "../ds";
import {
  getReasonCodes,
  reasonCodesForStatus,
  transitionLead,
  type LeadReasonCode,
  type LqSource,
} from "@/lib/crm/leadQualification";

/** Allowed forward transitions per current status (re-open handled separately). */
const TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "qualified", "unqualified", "disqualified"],
  contacted: ["qualified", "unqualified", "disqualified"],
  qualified: ["customer", "disqualified"],
  unqualified: ["contacted", "disqualified"],
  disqualified: [], // re-open only
  customer: [],
};

const REOPEN_TARGETS = ["new", "qualified"];

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function LeadTransitionControl({ leadId, currentStatus }: { leadId: string; currentStatus: string }) {
  const router = useRouter();
  const status = (currentStatus || "new").toLowerCase();
  const [codes, setCodes] = useState<LeadReasonCode[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [target, setTarget] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  const isDisqualified = status === "disqualified";
  const targetOptions = isDisqualified ? REOPEN_TARGETS : (TRANSITIONS[status] ?? []);

  useEffect(() => {
    let live = true;
    (async () => {
      setSource("loading");
      const { data, source: s } = await getReasonCodes();
      if (!live) return;
      setCodes(data);
      setSource(s);
    })();
    return () => { live = false; };
  }, []);

  const availableReasons = useMemo(
    () => (target ? reasonCodesForStatus(codes, target) : []),
    [codes, target],
  );

  function beginTransition() {
    setError("");
    setMessage("");
    if (!target) { setError("Choose a status to move this lead to."); return; }
    if (availableReasons.length > 0 && !reasonCode) { setError("Choose a reason code for this change."); return; }
    setConfirmOpen(true);
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      await transitionLead(leadId, {
        targetStatus: target,
        reasonCode: reasonCode || "OTHER",
        ...(note.trim() ? { reason: note.trim() } : {}),
      });
      setMessage(isDisqualified ? `Lead re-opened to "${target}".` : `Lead moved to "${target}".`);
      setConfirmOpen(false);
      setTarget("");
      setReasonCode("");
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the lead status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>{isDisqualified ? "Re-open lead" : "Change lead status"}</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Current status: <strong>{status}</strong>. Every change is recorded in the audit trail with its reason.
        </p>

        {targetOptions.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>No further status changes are available from “{status}”.</p>
        ) : (
          <>
            <div>
              <label htmlFor={`${headingId}-target`} style={labelStyle}>{isDisqualified ? "Re-open to" : "Move to"}</label>
              <select
                id={`${headingId}-target`}
                value={target}
                onChange={(e) => { setTarget(e.target.value); setReasonCode(""); }}
                style={inputStyle}
              >
                <option value="">Select status…</option>
                {targetOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor={`${headingId}-reason`} style={labelStyle}>Reason code</label>
              <select
                id={`${headingId}-reason`}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                disabled={!target || availableReasons.length === 0}
                aria-describedby={target && availableReasons.length === 0 ? `${headingId}-noreason` : undefined}
                style={inputStyle}
              >
                <option value="">{availableReasons.length === 0 ? "No reason codes configured" : "Select reason…"}</option>
                {availableReasons.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              {target && availableReasons.length === 0 ? (
                <p id={`${headingId}-noreason`} style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  No reason codes are configured for “{target}”. You can still add a note below.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${headingId}-note`} style={labelStyle}>Note (optional)</label>
              <textarea id={`${headingId}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...inputStyle, minHeight: undefined }} placeholder="Add context for the audit trail" />
            </div>

            <div>
              <button type="button" className="btn primary" onClick={beginTransition} style={{ minHeight: 44 }}>
                {isDisqualified ? "Re-open lead" : "Apply status change"}
              </button>
            </div>
          </>
        )}

        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={isDisqualified ? `Re-open lead to "${target}"?` : `Move lead to "${target}"?`}
        description="This change is recorded in the audit trail with the reason you selected."
        confirmLabel={isDisqualified ? "Re-open lead" : "Confirm change"}
        busy={busy}
        errorMessage={error || undefined}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void apply()}
      />
    </div>
  );
}
