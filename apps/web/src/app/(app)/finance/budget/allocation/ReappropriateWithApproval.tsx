"use client";

/**
 * Re-appropriation-with-eOffice-approval — the request-first raise flow.
 *
 * A budget re-appropriation doesn't pre-exist as a record, so this is a
 * create-and-raise action (modelled on TransferWithApproval). The request id is
 * a CLIENT-generated uuid so the same id is used as both the re-appropriation
 * request id and the eFile refId:
 *   1) POST /v1/finance/reappropriations/{uuid}/submit-approval → records a
 *      pending_approval re-appropriation request (returns that same id).
 *   2) POST /v1/estab/files/from-module → raises the eFile against that id
 *      (refType "finance_reappropriation"); on approval the finance
 *      reappropriation eoffice-consumer applies the change to the target budget.
 */

import { useCallback, useState } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ReappropriateWithApproval() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [budgetId, setBudgetId] = useState("");
  const [headId, setHeadId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [initiatedBy, setInitiatedBy] = useState("");
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");

  const reset = () => {
    setBudgetId(""); setHeadId(""); setAmount(""); setReason("");
    setInitiatedBy(""); setCurrentWith(""); setNote("");
  };

  const submit = useCallback(async () => {
    setError(""); setMessage("");
    if (!UUID_RE.test(budgetId)) { setError("Target budget ID must be a valid UUID."); return; }
    if (headId.trim().length > 0 && !UUID_RE.test(headId)) { setError("Head ID, if provided, must be a valid UUID."); return; }
    const amountMinor = Number(amount);
    if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor) || amountMinor < 0) {
      setError("Amount (in paise) must be a non-negative whole number."); return;
    }
    if (reason.trim().length < 3) { setError("Add a reason for the re-appropriation."); return; }
    if (!UUID_RE.test(initiatedBy) || !UUID_RE.test(currentWith)) { setError("Initiating and forward-to officer IDs must be valid eOffice operators."); return; }
    if (note.trim().length < 3) { setError("Add a justification note."); return; }

    setSaving(true);
    try {
      // Client-generated id: used as both the request id and the eFile refId.
      const reappropriationId = crypto.randomUUID();

      // Step 1 — create the pending re-appropriation request.
      const reqBody: { budgetId: string; headId?: string; amountMinor: number; reason: string } = {
        budgetId, amountMinor, reason: reason.trim(),
      };
      if (headId.trim().length > 0) reqBody.headId = headId.trim();
      const subRes = await fetch(`/api/proxy/v1/finance/reappropriations/${reappropriationId}/submit-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!subRes.ok) throw new Error((await subRes.text()) || "Could not create re-appropriation request");

      // Step 2 — raise the eFile against the re-appropriation request.
      const raiseRes = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refType: "finance_reappropriation",
          refId: reappropriationId,
          subject: `Budget re-appropriation — budget ${budgetId.slice(0, 8)}`,
          dept: "Finance",
          classification: "confidential",
          priority: "normal",
          initiatedBy,
          currentWith,
          approvalChain: "file_noting",
          initialNote: note.trim(),
          context: { budgetId, amountMinor, ...(reqBody.headId ? { headId: reqBody.headId } : {}) },
        }),
      });
      if (!raiseRes.ok) throw new Error((await raiseRes.text()) || "Re-appropriation request created, but raising the eFile failed");
      const file = (await raiseRes.json()) as { fileNo?: string };
      setMessage(`Re-appropriation raised for approval (eFile ${file.fileNo ?? ""}). On approval the budget head is updated automatically.`);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }, [budgetId, headId, amount, reason, initiatedBy, currentWith, note]);

  return (
    <>
      <button className="btn primary" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Re-appropriation with approval"}
      </button>

      {open ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Raise a re-appropriation for eOffice approval</h3></div>
          <div role="status" aria-live="polite">
            {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.8125rem", paddingBottom: 0 }}>{message}</p> : null}
            {error ? <p className="pad" style={{ color: "#b91c1c", fontSize: "0.8125rem", paddingBottom: 0 }}>{error}</p> : null}
          </div>
          <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Target budget ID</span>
              <input value={budgetId} placeholder="budget UUID" onChange={(e) => setBudgetId(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Head ID (optional)</span>
              <input value={headId} placeholder="head UUID" onChange={(e) => setHeadId(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Amount (paise)</span>
              <input inputMode="numeric" value={amount} placeholder="e.g. 5000000" onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Initiating officer (eOffice operator)</span>
              <input value={initiatedBy} placeholder="operator UUID" onChange={(e) => setInitiatedBy(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Forward to officer (eOffice operator)</span>
              <input value={currentWith} placeholder="operator UUID" onChange={(e) => setCurrentWith(e.target.value)} />
            </label>
          </div>
          <div className="pad" style={{ paddingTop: 0 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem", marginBottom: 12 }}>
              <span>Reason</span>
              <input value={reason} placeholder="Reason for the re-appropriation" onChange={(e) => setReason(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem", marginBottom: 12 }}>
              <span>Justification note</span>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary" disabled={saving} onClick={() => void submit()}>
              {saving ? "Raising…" : "Submit re-appropriation to eOffice"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
