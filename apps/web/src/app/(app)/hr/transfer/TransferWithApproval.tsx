"use client";

/**
 * Transfer-with-eOffice-approval — the request-first raise flow.
 *
 * UX: Replaces raw UUID inputs with searchable name-based dropdowns.
 * Two-step wizard: 1) Select employee + destination  2) Approval routing + justification
 *
 *   1) POST .../transfer/submit-approval  → creates a pending_approval transfer
 *      request and returns its id.
 *   2) POST /v1/estab/files/from-module   → raises the eFile against that
 *      request id (refType "hr_transfer"); it routes SO→US→DS and, on approval,
 *      the hrms eoffice-consumer effects the transfer.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Employee = { id: string; name?: string; designation?: string; departmentId?: string; department?: string };
type Department = { id: string; name: string };
type Officer = { id: string; name: string; designation?: string };

export function TransferWithApproval() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const [employeeId, setEmployeeId] = useState("");
  const [fromDeptId, setFromDeptId] = useState("");
  const [fromDeptName, setFromDeptName] = useState("");
  const [toDeptId, setToDeptId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [initiatedBy, setInitiatedBy] = useState("");
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");

  // Load employees, departments, and officers when form opens
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [empRes, deptRes, offRes] = await Promise.all([
          fetch("/api/proxy/v1/hrms/employees?limit=200"),
          fetch("/api/proxy/v1/hrms/departments?limit=200"),
          fetch("/api/proxy/v1/identity/users?limit=200"),
        ]);
        if (empRes.ok) {
          const body = (await empRes.json()) as { data?: Employee[] } | Employee[];
          setEmployees(Array.isArray(body) ? body : (body.data ?? []));
        }
        if (deptRes.ok) {
          const body = (await deptRes.json()) as { data?: Department[] } | Department[];
          setDepartments(Array.isArray(body) ? body : (body.data ?? []));
        }
        if (offRes.ok) {
          const body = (await offRes.json()) as { data?: Officer[] } | Officer[];
          setOfficers(Array.isArray(body) ? body : (body.data ?? []));
        }
      } catch { /* graceful fallback to text inputs */ }
    })();
  }, [open]);

  const reset = () => {
    setEmployeeId(""); setFromDeptId(""); setFromDeptName(""); setToDeptId("");
    setEffectiveDate(""); setInitiatedBy(""); setCurrentWith(""); setNote("");
    setStep(1);
  };

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  const validateStep1 = (): boolean => {
    if (!employeeId) { setError("Select an employee."); return false; }
    if (!toDeptId) { setError("Select the destination department."); return false; }
    if (!effectiveDate) { setError("Effective date is required."); return false; }
    setError("");
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!initiatedBy) { setError("Select the initiating officer."); return false; }
    if (!currentWith) { setError("Select who should approve this transfer."); return false; }
    if (note.trim().length < 3) { setError("Add a justification note (at least 3 characters)."); return false; }
    setError("");
    return true;
  };

  const submit = useCallback(async () => {
    if (!validateStep2()) return;
    setError("");
    setSaving(true);
    try {
      const subRes = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/transfer/submit-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromDeptId, toDeptId, effectiveDate }),
      });
      if (!subRes.ok) throw new Error((await subRes.text()) || "Could not create transfer request");
      const sub = (await subRes.json()) as { id?: string };
      const transferId = sub.id;
      if (!transferId) throw new Error("Transfer request id missing in response");

      const raiseRes = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refType: "hr_transfer",
          refId: transferId,
          subject: `Transfer order — ${selectedEmployee?.name ?? employeeId.slice(0, 8)}`,
          dept: "HR",
          classification: "confidential",
          priority: "normal",
          initiatedBy,
          currentWith,
          approvalChain: "file_noting",
          initialNote: note.trim(),
          context: { employeeId, fromDeptId, toDeptId, effectiveDate },
        }),
      });
      if (!raiseRes.ok) throw new Error((await raiseRes.text()) || "Transfer request created, but raising the eFile failed");
      const file = (await raiseRes.json()) as { fileNo?: string };
      toast.success(`Transfer raised for approval${file.fileNo ? ` (eFile ${file.fileNo})` : ""}. On approval the posting is effected automatically.`);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }, [employeeId, fromDeptId, toDeptId, effectiveDate, initiatedBy, currentWith, note, selectedEmployee, toast]);

  return (
    <>
      <button className="btn primary" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Transfer with approval"}
      </button>

      {open && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>Raise a transfer for eOffice approval</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--ink2)" }}>Step {step} of 2</span>
          </div>

          {error && (
            <div role="alert" aria-live="assertive">
              <p className="pad" style={{ color: "#b91c1c", fontSize: "0.8125rem", paddingBottom: 0 }}>⚠ {error}</p>
            </div>
          )}

          {step === 1 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                Select the employee and where they should be transferred to.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Employee</span>
                  <select
                    value={employeeId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setEmployeeId(id);
                      const emp = employees.find((x) => x.id === id);
                      if (emp?.departmentId) {
                        setFromDeptId(emp.departmentId);
                        setFromDeptName(emp.department ?? departments.find((d) => d.id === emp.departmentId)?.name ?? "");
                      }
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                  >
                    <option value="">Select employee…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name ?? e.id}{e.designation ? ` · ${e.designation}` : ""}{e.department ? ` (${e.department})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>From (current department)</span>
                  <input
                    value={fromDeptName || (departments.find((d) => d.id === fromDeptId)?.name ?? fromDeptId)}
                    disabled
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44, background: "#f9fafb", color: "var(--ink2)" }}
                    aria-label="Current department (auto-filled)"
                  />
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Transfer to (department)</span>
                  <select
                    value={toDeptId}
                    onChange={(e) => setToDeptId(e.target.value)}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                  >
                    <option value="">Select destination department…</option>
                    {departments.filter((d) => d.id !== fromDeptId).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {departments.length === 0 && (
                    <input
                      value={toDeptId}
                      placeholder="Department ID (loading departments…)"
                      onChange={(e) => setToDeptId(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  )}
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Effective date</span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="btn ghost" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
                <button className="btn primary" style={{ minHeight: 44 }} onClick={() => validateStep1() && setStep(2)}>
                  Next: Approval routing →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              {selectedEmployee && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
                  <strong>{selectedEmployee.name}</strong> → {departments.find((d) => d.id === toDeptId)?.name ?? toDeptId}
                  {effectiveDate && <> · Effective {effectiveDate}</>}
                </div>
              )}

              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                Select who initiates this file and who should approve it.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Initiating officer</span>
                  {officers.length > 0 ? (
                    <select
                      value={initiatedBy}
                      onChange={(e) => setInitiatedBy(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    >
                      <option value="">Select initiating officer…</option>
                      {officers.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}{o.designation ? ` · ${o.designation}` : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={initiatedBy}
                      placeholder="Officer ID"
                      onChange={(e) => setInitiatedBy(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  )}
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Forward to (approving officer)</span>
                  {officers.length > 0 ? (
                    <select
                      value={currentWith}
                      onChange={(e) => setCurrentWith(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    >
                      <option value="">Select approving officer…</option>
                      {officers.filter((o) => o.id !== initiatedBy).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}{o.designation ? ` · ${o.designation}` : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={currentWith}
                      placeholder="Officer ID"
                      onChange={(e) => setCurrentWith(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  )}
                </label>
              </div>

              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span style={{ fontWeight: 600 }}>Justification note</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why is this transfer being initiated? This will appear in the eFile noting."
                  style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", resize: "vertical" }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
                <button className="btn primary" style={{ minHeight: 44 }} disabled={saving} onClick={() => void submit()}>
                  {saving ? "Raising…" : "Submit transfer to eOffice"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
