"use client";

/**
 * RaiseEOfficeNote — drop-in, reusable in-module eOffice integration control.
 *
 * Shows the current eOffice file status for a business entity (sanction, PO,
 * transfer, grant, …) and lets an officer raise it for formal, immutable,
 * auditable approval. The amount drives automatic routing through the eOffice
 * approval matrix; an explicit approval chain is used as the fallback.
 *
 * Usage:
 *   <RaiseEOfficeNote
 *     refType="finance_sanction"
 *     refId={sanction.id}
 *     subject={sanction.subject}
 *     dept="Finance"
 *     amountMinor={sanction.amount}
 *     defaultApprovalChain="finance.sanction.standard"
 *   />
 */

import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "./ds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RaiseEOfficeNoteProps = {
  refType: string;
  refId: string;
  subject: string;
  dept: string;
  /** Decision-relevant amount in minor units (paise); drives matrix routing.
   *  Accepts a bigint-safe decimal string (the convention this codebase's
   *  money fields use, e.g. SanctionDetail.amount) as well as a plain
   *  number — this component only forwards it in `context`, it never does
   *  arithmetic on it locally. */
  amountMinor?: number | string;
  /** Fallback workflow definition code when no matrix rule matches. */
  defaultApprovalChain?: string;
  classification?: "top_secret" | "secret" | "confidential" | "public";
  priority?: "normal" | "urgent" | "immediate";
  /**
   * Optional source-module endpoint (proxy path) called after a successful
   * raise so the originating entity can move to "pending approval". Closes the
   * loop visually until the eOffice decision callback lands.
   */
  notifyPath?: string;
};

type LinkedFile = {
  id: string;
  file_no: string;
  status: string;
};

export function RaiseEOfficeNote(props: RaiseEOfficeNoteProps) {
  const {
    refType, refId, subject, dept,
    amountMinor, defaultApprovalChain = "estab.generic.standard",
    classification = "confidential", priority = "normal",
    notifyPath,
  } = props;

  const [file, setFile] = useState<LinkedFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [initiatedBy, setInitiatedBy] = useState("");
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ refType, refId });
      const res = await fetch(`/api/proxy/v1/estab/files/by-ref?${qs.toString()}`);
      if (res.status === 404) { setFile(null); return; }
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { data?: LinkedFile };
      setFile(body.data ?? null);
    } catch {
      // Status is best-effort; a failure here shouldn't block the raise action.
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [refType, refId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const submit = useCallback(async () => {
    setError("");
    setMessage("");
    if (!UUID_RE.test(initiatedBy)) { setError("Initiating officer must be a valid ID."); return; }
    if (!UUID_RE.test(currentWith)) { setError("Forward-to officer must be a valid ID."); return; }
    if (note.trim().length < 3) { setError("Add a note explaining the proposal."); return; }
    setSaving(true);
    try {
      const payload = {
        refType, refId, subject, dept, classification, priority,
        initiatedBy, currentWith,
        approvalChain: defaultApprovalChain,
        initialNote: note.trim(),
        context: amountMinor != null ? { amountMinor } : {},
      };
      const res = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || "Failed to raise eFile");
      const body = (await res.json()) as { id?: string; fileNo?: string };
      // Close the loop on the source side: move the originating entity to
      // "pending approval" so its own screen reflects the in-flight decision.
      if (notifyPath) {
        try {
          await fetch(notifyPath, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        } catch {
          /* best-effort; the eOffice file is already raised */
        }
      }
      setMessage(`Raised eFile ${body.fileNo ?? ""} for approval. Routing by amount via the approval matrix.`);
      setOpen(false);
      setNote("");
      setTimeout(() => void loadStatus(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to raise eFile");
    } finally {
      setSaving(false);
    }
  }, [initiatedBy, currentWith, note, refType, refId, subject, dept, classification, priority, defaultApprovalChain, amountMinor, loadStatus]);

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>eOffice approval</h3>
        {loading ? (
          <span style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>Checking…</span>
        ) : file ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: "0.8125rem" }}>{file.file_no}</span>
            <StatusPill status={file.status} />
            <a className="btn ghost" href={`/estab/files/${file.id}`}>Open file</a>
          </span>
        ) : (
          <button className="btn primary" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Raise for approval"}
          </button>
        )}
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.8125rem", paddingBottom: 0 }}>{message}</p> : null}
        {error ? <p className="pad" style={{ color: "#b91c1c", fontSize: "0.8125rem", paddingBottom: 0 }}>{error}</p> : null}
      </div>

      {!file && open ? (
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
            Raising sends this {refType.replace(/_/g, " ")} to eOffice for a formal, tamper-proof decision.
            The approval chain is selected automatically by amount.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Initiating officer ID</span>
              <input value={initiatedBy} placeholder="employee UUID" onChange={(e) => setInitiatedBy(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Forward to officer ID</span>
              <input value={currentWith} placeholder="approver UUID" onChange={(e) => setCurrentWith(e.target.value)} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Proposal note</span>
            <textarea value={note} rows={3} placeholder="Justification / proposal for approval…" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div>
            <button className="btn primary" disabled={saving} onClick={() => void submit()}>
              {saving ? "Raising…" : "Submit to eOffice"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
