"use client";

/**
 * Promotion-with-eOffice-approval — the request-first raise flow.
 *
 * HR promotions don't pre-exist as an entity, so this is a two-step action
 * (modelled on TransferWithApproval):
 *   1) POST .../promotion/submit-approval → records a pending_approval promotion
 *      request and returns its id.
 *   2) POST /v1/estab/files/from-module   → raises the eFile against that
 *      request id (refType "hr_promotion"); it routes for approval and, on
 *      approval, the hrms promotion eoffice-consumer effects the promotion.
 */

import { useCallback, useEffect, useState } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Employee = { id: string; name?: string; designation?: string; designationId?: string };

export function PromoteWithApproval() {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [fromDesigId, setFromDesigId] = useState("");
  const [toDesigId, setToDesigId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [initiatedBy, setInitiatedBy] = useState("");
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/hrms/employees?limit=200");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Employee[] } | Employee[];
        setEmployees(Array.isArray(body) ? body : (body.data ?? []));
      } catch { /* picker optional */ }
    })();
  }, [open]);

  const reset = () => {
    setEmployeeId(""); setFromDesigId(""); setToDesigId(""); setEffectiveDate("");
    setOrderRef(""); setInitiatedBy(""); setCurrentWith(""); setNote("");
  };

  const submit = useCallback(async () => {
    setError(""); setMessage("");
    if (!UUID_RE.test(employeeId)) { setError("Select an employee."); return; }
    if (!UUID_RE.test(fromDesigId) || !UUID_RE.test(toDesigId)) { setError("From and To designation IDs must be valid."); return; }
    if (!effectiveDate) { setError("Effective date is required."); return; }
    if (!UUID_RE.test(initiatedBy) || !UUID_RE.test(currentWith)) { setError("Initiating and forward-to officer IDs must be valid eOffice operators."); return; }
    if (note.trim().length < 3) { setError("Add a justification note."); return; }

    setSaving(true);
    try {
      // Step 1 — create the pending promotion request.
      const reqBody: { fromDesigId: string; toDesigId: string; effectiveDate: string; orderRef?: string } = {
        fromDesigId, toDesigId, effectiveDate,
      };
      if (orderRef.trim().length > 0) reqBody.orderRef = orderRef.trim();
      const subRes = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/promotion/submit-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!subRes.ok) throw new Error((await subRes.text()) || "Could not create promotion request");
      const sub = (await subRes.json()) as { id?: string };
      const promotionId = sub.id;
      if (!promotionId) throw new Error("Promotion request id missing in response");

      // Step 2 — raise the eFile against the promotion request.
      const raiseRes = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refType: "hr_promotion",
          refId: promotionId,
          subject: `Promotion order — employee ${employeeId.slice(0, 8)}`,
          dept: "HR",
          classification: "confidential",
          priority: "normal",
          initiatedBy,
          currentWith,
          approvalChain: "file_noting",
          initialNote: note.trim(),
          context: { employeeId, fromDesigId, toDesigId, effectiveDate },
        }),
      });
      if (!raiseRes.ok) throw new Error((await raiseRes.text()) || "Promotion request created, but raising the eFile failed");
      const file = (await raiseRes.json()) as { fileNo?: string };
      setMessage(`Promotion raised for approval (eFile ${file.fileNo ?? ""}). On approval the new grade is effected automatically.`);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }, [employeeId, fromDesigId, toDesigId, effectiveDate, orderRef, initiatedBy, currentWith, note]);

  return (
    <>
      <button className="btn primary" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Promotion with approval"}
      </button>

      {open ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>Raise a promotion for eOffice approval</h3></div>
          <div role="status" aria-live="polite">
            {message ? <p className="pad" style={{ color: "#047857", fontSize: "0.8125rem", paddingBottom: 0 }}>{message}</p> : null}
            {error ? <p className="pad" style={{ color: "#b91c1c", fontSize: "0.8125rem", paddingBottom: 0 }}>{error}</p> : null}
          </div>
          <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Employee</span>
              {employees.length > 0 ? (
                <select value={employeeId} onChange={(e) => {
                  const id = e.target.value; setEmployeeId(id);
                  const emp = employees.find((x) => x.id === id);
                  if (emp?.designationId) setFromDesigId(emp.designationId);
                }}>
                  <option value="">Select employee…</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}{e.designation ? ` · ${e.designation}` : ""}</option>)}
                </select>
              ) : (
                <input value={employeeId} placeholder="employee UUID" onChange={(e) => setEmployeeId(e.target.value)} />
              )}
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>From designation ID</span>
              <input value={fromDesigId} placeholder="designation UUID" onChange={(e) => setFromDesigId(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>To designation ID</span>
              <input value={toDesigId} placeholder="designation UUID" onChange={(e) => setToDesigId(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Effective date</span>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Order reference (optional)</span>
              <input value={orderRef} placeholder="order no / reference" onChange={(e) => setOrderRef(e.target.value)} />
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
              <span>Justification note</span>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary" disabled={saving} onClick={() => void submit()}>
              {saving ? "Raising…" : "Submit promotion to eOffice"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
