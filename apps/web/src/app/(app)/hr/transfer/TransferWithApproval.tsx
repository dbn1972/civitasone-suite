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
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Employee = { id: string; name?: string; designation?: string; departmentId?: string; department?: string };
type Department = { id: string; name: string };
type Officer = { id: string; name: string; designation?: string };
type PayStructureOption = { id: string; name?: string; code?: string };
type LookupStatus = "loading" | "ok" | "error";

interface Props {
  /**
   * GAP-HR-TRANSFER-09: employee detail's "Initiate Transfer" quick action
   * links to `/hr/transfer?empId=...`, but nothing here ever read it -- the
   * wizard always opened closed and blank regardless. transfer/page.tsx
   * resolves the id to a real employee record server-side (name only --
   * EmployeeDetailSchema has no departmentId, only a department NAME) and
   * passes it down; validated as a real, existing employee before use,
   * never trusted as a raw pass-through id. The department is filled in
   * here once the employees list loads, via the exact same
   * departmentId/department resolution the manual employee <select>'s
   * onChange already does below -- not re-derived a second way.
   */
  prefillEmployee?: { id: string; name: string } | null;
}

export function TransferWithApproval({ prefillEmployee }: Props = {}) {
  const [open, setOpen] = useState(Boolean(prefillEmployee));
  const [step, setStep] = useState<1 | 2>(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [payStructures, setPayStructures] = useState<PayStructureOption[]>([]);
  const [deptStatus, setDeptStatus] = useState<LookupStatus>("loading");
  const [officerStatus, setOfficerStatus] = useState<LookupStatus>("loading");
  const [payStructureStatus, setPayStructureStatus] = useState<LookupStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const formError = useFormError("transfer request");

  const [employeeId, setEmployeeId] = useState(prefillEmployee?.id ?? "");
  const [fromDeptId, setFromDeptId] = useState("");
  const [fromDeptName, setFromDeptName] = useState("");
  const [toDeptId, setToDeptId] = useState("");
  // HIGH fix (PR #1552 review): optional -- omitting it means "no pay-
  // structure change", not an error. Backend already accepts it on both
  // transfer paths (lifecycle/validators.ts's transferBody, applied by
  // employee/consumer.ts and lifecycle/eoffice-consumer.ts); this wires the
  // one remaining gap, the actual UI never sending it.
  const [payStructureId, setPayStructureId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [initiatedBy, setInitiatedBy] = useState("");
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");
  // Set once step 1 (create the pending_approval transfer request) succeeds.
  // Retrying after a step-2 (eFile) failure must resume from here instead of
  // re-running step 1 — otherwise every retry created a brand-new duplicate
  // transfer request for the same employee, since submit-approval has no
  // idempotency key and the old code always restarted from step 1.
  const [submittedTransferId, setSubmittedTransferId] = useState<string | null>(null);

  // Load employees, departments, and officers when form opens
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDeptStatus("loading"); setOfficerStatus("loading"); setPayStructureStatus("loading");
    void (async () => {
      try {
        const [empRes, deptRes, offRes, psRes] = await Promise.all([
          fetch("/api/proxy/v1/hrms/employees?limit=200", { signal: controller.signal }),
          fetch("/api/proxy/v1/hrms/departments?limit=200", { signal: controller.signal }),
          fetch("/api/proxy/v1/identity/users?limit=200", { signal: controller.signal }),
          // Same endpoint/pattern as EditEmployeeForm.tsx's pay-structure picker.
          fetch("/api/proxy/v1/payroll/structures?limit=200", { signal: controller.signal }),
        ]);
        if (empRes.ok) {
          const body = (await empRes.json()) as { data?: Employee[] } | Employee[];
          setEmployees(Array.isArray(body) ? body : (body.data ?? []));
        }
        if (deptRes.ok) {
          const body = (await deptRes.json()) as { data?: Department[] } | Department[];
          setDepartments(Array.isArray(body) ? body : (body.data ?? []));
          setDeptStatus("ok");
        } else {
          setDeptStatus("error");
        }
        if (offRes.ok) {
          const body = (await offRes.json()) as { data?: Officer[] } | Officer[];
          setOfficers(Array.isArray(body) ? body : (body.data ?? []));
          setOfficerStatus("ok");
        } else {
          setOfficerStatus("error");
        }
        if (psRes.ok) {
          const body = (await psRes.json()) as { data?: PayStructureOption[] } | PayStructureOption[];
          setPayStructures(Array.isArray(body) ? body : (body.data ?? []));
          setPayStructureStatus("ok");
        } else {
          // Pay structure is optional -- a failed fetch just means "no
          // change" stays the only option, not a hard error state.
          setPayStructureStatus("ok");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setDeptStatus((s) => (s === "loading" ? "error" : s));
        setOfficerStatus((s) => (s === "loading" ? "error" : s));
        // Pay structure is optional; never leave its select stuck disabled.
        setPayStructureStatus((s) => (s === "loading" ? "ok" : s));
      }
    })();
    return () => controller.abort();
  }, [open, reloadKey]);

  // GAP-HR-TRANSFER-09: once the employees list loads, fill in the
  // prefilled employee's current department -- the exact same resolution
  // the Employee <select>'s own onChange uses below, just triggered by data
  // arriving instead of a user pick.
  useEffect(() => {
    if (!prefillEmployee || employeeId !== prefillEmployee.id || fromDeptId) return;
    const emp = employees.find((x) => x.id === prefillEmployee.id);
    if (emp?.departmentId) {
      setFromDeptId(emp.departmentId);
      setFromDeptName(emp.department ?? departments.find((d) => d.id === emp.departmentId)?.name ?? "");
    }
  }, [employees, departments, prefillEmployee, employeeId, fromDeptId]);

  const reset = () => {
    setEmployeeId(prefillEmployee?.id ?? "");
    setFromDeptId("");
    setFromDeptName("");
    setToDeptId("");
    setPayStructureId("");
    setEffectiveDate(""); setInitiatedBy(""); setCurrentWith(""); setNote("");
    setSubmittedTransferId(null);
    setStep(1);
  };

  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? (prefillEmployee && prefillEmployee.id === employeeId ? { id: prefillEmployee.id, name: prefillEmployee.name } : undefined);

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
      // Resume from an already-created request instead of re-running step 1.
      // submit-approval has no idempotency key, so calling it again on retry
      // would create a second, distinct pending_approval transfer request for
      // the same employee every time the eFile step failed.
      let transferId = submittedTransferId;
      if (!transferId) {
        const subRes = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/transfer/submit-approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // payStructureId is optional server-side (lifecycle/validators.ts's
          // transferBody) -- omit it entirely rather than sending "" so a
          // transfer with no pay-structure change is unambiguously "no
          // change", not an empty-string value.
          body: JSON.stringify({
            fromDeptId, toDeptId, effectiveDate,
            payStructureId: payStructureId || undefined,
          }),
        });
        if (!subRes.ok) {
          // GAP-HR-TRANSFER-03: this used to be `throw new Error((await
          // subRes.text()) || "...")` -- the raw response body (which can be
          // an unstyled JSON envelope or an internal error string) shown
          // directly to the user. Route it through the same clerk-safe
          // useFormError path TransferOrderCard.tsx already uses.
          const resolved = await formError.fromResponse(subRes, "save");
          throw new Error(resolved.message);
        }
        const sub = (await subRes.json()) as { id?: string };
        if (!sub.id) throw new Error("Transfer request id missing in response");
        transferId = sub.id;
        setSubmittedTransferId(transferId);
      }

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
      if (!raiseRes.ok) {
        const resolved = await formError.fromResponse(raiseRes, "save");
        throw new Error(
          `Transfer request created, but raising the eFile failed (${resolved.message}). It is safe to click Submit again — it will retry only the eFile step, not create another transfer request.`,
        );
      }
      const file = (await raiseRes.json()) as { fileNo?: string };
      toast.success(`Transfer raised for approval${file.fileNo ? ` (eFile ${file.fileNo})` : ""}. On approval the posting is effected automatically.`);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : formError.fromException("save").message);
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- validateStep2 is redefined each render but only closes over values already listed in this array (initiatedBy, currentWith, note[, t]).
  }, [employeeId, fromDeptId, toDeptId, payStructureId, effectiveDate, initiatedBy, currentWith, note, selectedEmployee, submittedTransferId, toast, formError]);

  return (
    <>
      <Button onClick={() => { if (open) reset(); setOpen((v) => !v); }}>
        {open ? "Cancel" : "+ Transfer with approval"}
      </Button>

      {open && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>Raise a transfer for eOffice approval</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--ink2)" }}>Step {step} of 2</span>
          </div>

          {error && (
            <div role="alert" aria-live="assertive">
              <p className="pad" style={{ color: "var(--bad, #b91c1c)", fontSize: "0.8125rem", paddingBottom: 0 }}>⚠ {error}</p>
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
                    {/* GAP-HR-TRANSFER-09: the prefilled employee must always
                        be selectable even if they fall outside this
                        unsearched limit=200 list. */}
                    {prefillEmployee && !employees.some((e) => e.id === prefillEmployee.id) && (
                      <option value={prefillEmployee.id}>{prefillEmployee.name}</option>
                    )}
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
                  {/* GAP-HR-TRANSFER-06: a failed departments fetch used to
                      silently swap in a raw "Department ID" text box --
                      asking a clerk to type a UUID with no guidance on
                      where to find one. Shows an honest error + retry
                      instead; Next already can't proceed without a real
                      selection (validateStep1). */}
                  {deptStatus === "error" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--bad, #b91c1c)", fontSize: "0.75rem" }}>Couldn't load departments.</span>
                      <Button type="button" variant="ghost" style={{ fontSize: 12 }} onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
                    </div>
                  ) : (
                    <select
                      value={toDeptId}
                      onChange={(e) => setToDeptId(e.target.value)}
                      disabled={deptStatus === "loading"}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    >
                      <option value="">{deptStatus === "loading" ? "Loading departments…" : "Select destination department…"}</option>
                      {departments.filter((d) => d.id !== fromDeptId).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
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

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>New pay structure (optional)</span>
                  <select
                    value={payStructureId}
                    onChange={(e) => setPayStructureId(e.target.value)}
                    disabled={payStructureStatus === "loading"}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                  >
                    <option value="">No change</option>
                    {payStructures.map((ps) => (
                      <option key={ps.id} value={ps.id}>{ps.name ?? ps.code ?? ps.id}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
                <Button style={{ minHeight: 44 }} onClick={() => validateStep1() && setStep(2)}>
                  Next: Approval routing →
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              {submittedTransferId && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--warnbg, #fffbeb)", borderRadius: 8, border: "1px solid var(--warnbd, #fde68a)" }}>
                  The transfer request was already created — retrying now only raises the eFile, it will not create a duplicate.
                </div>
              )}
              {selectedEmployee && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--infobg, #f0f9ff)", borderRadius: 8, border: "1px solid var(--infobd, #bae6fd)" }}>
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
                  {officerStatus === "error" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--bad, #b91c1c)", fontSize: "0.75rem" }}>Couldn't load officers.</span>
                      <Button type="button" variant="ghost" style={{ fontSize: 12 }} onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
                    </div>
                  ) : (
                    <select
                      value={initiatedBy}
                      onChange={(e) => setInitiatedBy(e.target.value)}
                      disabled={officerStatus === "loading"}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    >
                      <option value="">{officerStatus === "loading" ? "Loading officers…" : "Select initiating officer…"}</option>
                      {officers.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}{o.designation ? ` · ${o.designation}` : ""}</option>
                      ))}
                    </select>
                  )}
                </label>

                <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600 }}>Forward to (approving officer)</span>
                  {officerStatus === "error" ? (
                    <span style={{ color: "var(--bad, #b91c1c)", fontSize: "0.75rem" }}>Couldn't load officers.</span>
                  ) : (
                    <select
                      value={currentWith}
                      onChange={(e) => setCurrentWith(e.target.value)}
                      disabled={officerStatus === "loading"}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
                    >
                      <option value="">{officerStatus === "loading" ? "Loading officers…" : "Select approving officer…"}</option>
                      {officers.filter((o) => o.id !== initiatedBy).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}{o.designation ? ` · ${o.designation}` : ""}</option>
                      ))}
                    </select>
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
                <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
                <Button style={{ minHeight: 44 }} disabled={saving} loading={saving} onClick={() => void submit()}>
                  {saving ? "Raising…" : "Submit transfer to eOffice"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
