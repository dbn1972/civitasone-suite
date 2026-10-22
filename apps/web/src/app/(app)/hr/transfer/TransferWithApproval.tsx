"use client";

/**
 * Transfer-with-eOffice-approval — the request-first raise flow.
 *
 * UX: Replaces raw UUID inputs with searchable name-based pickers.
 * Two-step wizard: 1) Select employee + destination  2) Approval routing + justification
 *
 *   1) POST .../transfer/submit-approval  → creates a pending_approval transfer
 *      request and returns its id.
 *   2) POST /v1/estab/files/from-module   → raises the eFile against that
 *      request id (refType "hr_transfer"); it routes SO→US→DS and, on approval,
 *      the hrms eoffice-consumer effects the transfer.
 *
 * GAP-HR-TRANSFER-06: no lookup ever degrades to a raw-id text box. The
 * employee is chosen with the server-searching EmployeePicker (GET
 * /v1/hrms/employees?q=, tenant-scoped, so it reaches past the old
 * limit=200 list), the destination department has its own loading / error /
 * forbidden state (an honest message + Retry, never a UUID input), "Next" is
 * disabled until the departments have actually loaded, and the "From"
 * department is shown by NAME only -- when it cannot be determined the field
 * says so and the wizard refuses to continue rather than send an empty
 * fromDeptId (the backend would 400 on it anyway).
 */

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/app/_components/ds/Toast";
import { Button, Field, Input, Select, Textarea, type EntityOption } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import { resolveEmployees } from "@/lib/entityAdapters/employee";
import { useFormError } from "@/lib/useFormError";
import { useSelfEmployee } from "@/app/_components/useSelfEmployee";

type Department = { id: string; name: string };
type PayStructureOption = { id: string; name?: string; code?: string };
type LookupStatus = "loading" | "ok" | "error" | "forbidden";

interface Props {
  /**
   * GAP-HR-TRANSFER-09: employee detail's "Initiate Transfer" quick action
   * links to `/hr/transfer?empId=...`, but nothing here ever read it -- the
   * wizard always opened closed and blank regardless. transfer/page.tsx
   * resolves the id to a real employee record server-side (name only --
   * EmployeeDetailSchema has no departmentId, only a department NAME) and
   * passes it down; validated as a real, existing employee before use,
   * never trusted as a raw pass-through id. The department is resolved here
   * through the same employee-directory lookup the picker uses, so a
   * prefilled employee is always selectable and shown by name.
   */
  prefillEmployee?: { id: string; name: string } | null;
}

/** The employee list/search/detail endpoints expose the department NAME only
 * ("—" when unresolved), never its id; the id is recovered by matching that
 * name against the tenant's department list. A name that matches zero or more
 * than one department is treated as unknown -- never guessed. */
function resolveFromDepartment(name: string, departments: Department[]): Department | null {
  const wanted = name.trim();
  if (!wanted || wanted === "—") return null;
  const matches = departments.filter((d) => d.name.trim() === wanted);
  return matches.length === 1 ? (matches[0] as Department) : null;
}

export function TransferWithApproval({ prefillEmployee }: Props = {}) {
  // GAP-HR-TRANSFER-10: all copy comes from the transferUi namespace.
  const tr = useTranslations("transferUi");
  const [open, setOpen] = useState(Boolean(prefillEmployee));
  const [step, setStep] = useState<1 | 2>(1);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [payStructures, setPayStructures] = useState<PayStructureOption[]>([]);
  const [deptStatus, setDeptStatus] = useState<LookupStatus>("loading");
  const [payStructureStatus, setPayStructureStatus] = useState<LookupStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Per-field validation messages (same tr() copy the old banner showed), surfaced via Field `error`.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"employeeId" | "toDeptId" | "effectiveDate" | "initiatedBy" | "currentWith" | "note", string>>>({});
  const { toast } = useToast();
  const formError = useFormError("transfer request");

  const [employeeId, setEmployeeId] = useState(prefillEmployee?.id ?? "");
  // Label ("Name (EMP-001)") and current-department NAME of the chosen employee.
  const [employeeLabel, setEmployeeLabel] = useState(prefillEmployee?.name ?? "");
  const [employeeDeptName, setEmployeeDeptName] = useState("");
  const [employeeDeptResolving, setEmployeeDeptResolving] = useState(Boolean(prefillEmployee));
  const [toDeptId, setToDeptId] = useState("");
  // HIGH fix (PR #1552 review): optional -- omitting it means "no pay-
  // structure change", not an error. Backend already accepts it on both
  // transfer paths (lifecycle/validators.ts's transferBody, applied by
  // employee/consumer.ts and lifecycle/eoffice-consumer.ts); this wires the
  // one remaining gap, the actual UI never sending it.
  const [payStructureId, setPayStructureId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  // The initiating officer is always the signed-in employee (the estab route rejects any other initiator).
  const self = useSelfEmployee(open);
  const initiatedBy = self?.id ?? "";
  const [currentWith, setCurrentWith] = useState("");
  const [note, setNote] = useState("");
  // Set once step 1 (create the pending_approval transfer request) succeeds.
  // Retrying after a step-2 (eFile) failure must resume from here instead of
  // re-running step 1 — otherwise every retry created a brand-new duplicate
  // transfer request for the same employee, since submit-approval has no
  // idempotency key and the old code always restarted from step 1.
  const [submittedTransferId, setSubmittedTransferId] = useState<string | null>(null);

  // The prefilled employee is always an option, labelled by name, even when
  // they would never surface in the picker's first 20 search results.
  const prefillId = prefillEmployee?.id;
  const prefillOption = useMemo<EntityOption | undefined>(
    () => (prefillEmployee ? { id: prefillEmployee.id, label: prefillEmployee.name } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id: the server re-sends an equal object each render
    [prefillEmployee?.id, prefillEmployee?.name],
  );

  // Load departments and pay structures when the form opens
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDeptStatus("loading"); setPayStructureStatus("loading");
    void (async () => {
      try {
        const [deptRes, psRes] = await Promise.all([
          fetch("/api/proxy/v1/hrms/departments?limit=200", { signal: controller.signal }),
          // Same endpoint/pattern as EditEmployeeForm.tsx's pay-structure picker.
          fetch("/api/proxy/v1/payroll/structures?limit=200", { signal: controller.signal }),
        ]);
        if (deptRes.ok) {
          const body = (await deptRes.json()) as { data?: Department[] } | Department[];
          setDepartments(Array.isArray(body) ? body : (body.data ?? []));
          setDeptStatus("ok");
        } else {
          // A real 403 is a permission boundary -- retrying can never fix it.
          setDeptStatus(deptRes.status === 403 ? "forbidden" : "error");
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
        // Pay structure is optional; never leave its select stuck disabled.
        setPayStructureStatus((s) => (s === "loading" ? "ok" : s));
      }
    })();
    return () => controller.abort();
  }, [open, reloadKey]);

  // GAP-HR-TRANSFER-09: a prefilled employee arrives as {id, name} only; look
  // up their current department NAME through the same directory endpoint the
  // picker uses (GET /v1/hrms/employees?ids=).
  useEffect(() => {
    if (!open || !prefillId || employeeId !== prefillId) return;
    let cancelled = false;
    setEmployeeDeptResolving(true);
    resolveEmployees([prefillId])
      .then((opts) => {
        if (cancelled) return;
        setEmployeeDeptName(opts[0]?.sublabel ?? "");
        if (opts[0]?.label) setEmployeeLabel(opts[0].label);
      })
      .catch(() => { /* leaves the department unknown -> "Not available", wizard blocked */ })
      .finally(() => { if (!cancelled) setEmployeeDeptResolving(false); });
    return () => { cancelled = true; };
  }, [open, prefillId, employeeId]);

  const fromDept = useMemo(
    () => (deptStatus === "ok" ? resolveFromDepartment(employeeDeptName, departments) : null),
    [deptStatus, employeeDeptName, departments],
  );
  const fromDeptPending = Boolean(employeeId) && (deptStatus === "loading" || employeeDeptResolving);
  const fromDeptDisplay = !employeeId ? "" : fromDept ? fromDept.name : fromDeptPending ? tr("loadingDepts") : tr("notAvailable");

  const reset = () => {
    setEmployeeId(prefillEmployee?.id ?? "");
    setEmployeeLabel(prefillEmployee?.name ?? "");
    setEmployeeDeptName("");
    setEmployeeDeptResolving(Boolean(prefillEmployee));
    setToDeptId("");
    setPayStructureId("");
    setEffectiveDate(""); setCurrentWith(""); setNote("");
    setSubmittedTransferId(null);
    setFieldErrors({});
    setStep(1);
  };

  const validateStep1 = (): boolean => {
    const errs: typeof fieldErrors = {};
    if (!employeeId) errs.employeeId = tr("errSelectEmployee");
    else if (!fromDept) errs.employeeId = tr("errFromDeptUnavailable");
    if (!toDeptId) errs.toDeptId = tr("errSelectDest");
    else if (fromDept && toDeptId === fromDept.id) errs.toDeptId = tr("errSameDept");
    if (!effectiveDate) errs.effectiveDate = tr("errEffectiveDate");
    setFieldErrors(errs);
    setError("");
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = (): boolean => {
    const errs: typeof fieldErrors = {};
    if (!initiatedBy) errs.initiatedBy = tr("errInitiatorUnknown");
    if (!currentWith) errs.currentWith = tr("errSelectApprover");
    else if (currentWith === initiatedBy) errs.currentWith = tr("errInitiatorEqualsApprover");
    if (note.trim().length < 3) errs.note = tr("errNote");
    setFieldErrors(errs);
    // Both ids are HRMS employee ids (self from /hrms/me/profile, forward-to from the employee picker).
    setError("");
    return Object.keys(errs).length === 0;
  };

  const submit = useCallback(async () => {
    if (!validateStep2()) return;
    setError("");
    // Never send an empty fromDeptId (the backend requires a UUID).
    if (!fromDept) { setError(tr("errFromDeptUnavailable")); return; }
    const fromDeptId = fromDept.id;
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
          throw UserFacingError.from(resolved);
        }
        const sub = (await subRes.json()) as { id?: string };
        if (!sub.id) throw new UserFacingError(tr("errMissingId"));
        transferId = sub.id;
        setSubmittedTransferId(transferId);
      }

      const raiseRes = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refType: "hr_transfer",
          refId: transferId,
          subject: tr("efileSubject", { name: employeeLabel || employeeId.slice(0, 8) }),
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
        throw new UserFacingError(
          tr("errEfileFailed", { message: resolved.message }),
          resolved.reference,
        );
      }
      const file = (await raiseRes.json()) as { fileNo?: string };
      toast.success(file.fileNo ? tr("raisedToastWithFile", { fileNo: file.fileNo }) : tr("raisedToast"));
      reset();
      setOpen(false);
    } catch (err) {
      setError(formError.fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- validateStep2 is redefined each render but only closes over values already listed in this array (initiatedBy, currentWith, note[, t]).
  }, [employeeId, employeeLabel, fromDept, toDeptId, payStructureId, effectiveDate, initiatedBy, currentWith, note, submittedTransferId, toast, formError, tr]);

  const toDeptName = departments.find((d) => d.id === toDeptId)?.name ?? tr("notAvailable");

  return (
    <>
      <Button onClick={() => { if (open) reset(); setOpen((v) => !v); }}>
        {open ? tr("cancel") : tr("openBtn")}
      </Button>

      {open && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>{tr("heading")}</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--ink2)" }}>{tr("stepOf", { step })}</span>
          </div>

          {error && (
            <div role="alert" aria-live="assertive">
              <p className="pad" style={{ color: "var(--bad)", fontSize: "0.8125rem", paddingBottom: 0 }}>⚠ {error}</p>
            </div>
          )}

          {step === 1 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                {tr("step1Intro")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <Field label={tr("employee")} required error={fieldErrors.employeeId}>
                  {/* GAP-HR-TRANSFER-06: server-side name search (EmployeePicker
                      -> GET /v1/hrms/employees?q=) instead of a native <select>
                      over the first 200 employees; a failed search shows the
                      picker's own "could not load" alert, never "No matches". */}
                  <EmployeePicker
                    value={employeeId || null}
                    initialOption={prefillOption}
                    placeholder={tr("selectEmployee")}
                    onChange={(id, option) => {
                      setEmployeeId(id ?? "");
                      setEmployeeLabel(option?.label ?? "");
                      setEmployeeDeptName(option?.sublabel ?? "");
                      setEmployeeDeptResolving(false);
                    }}
                  />
                </Field>

                <Field label={tr("fromDept")} disabled>
                  <Input
                    value={fromDeptDisplay}
                    readOnly
                    style={{ color: "var(--ink2)" }}
                    aria-label={tr("fromDeptAria")}
                  />
                </Field>

                <Field label={tr("toDept")} required error={fieldErrors.toDeptId}>
                  {/* GAP-HR-TRANSFER-06: a failed departments fetch used to
                      silently swap in a raw "Department ID" text box --
                      asking a clerk to type a UUID with no guidance on
                      where to find one. Shows an honest error + retry
                      instead (or a permission message for a real 403);
                      "Next" is disabled until the list has loaded. */}
                  {deptStatus === "error" || deptStatus === "forbidden" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span role="alert" style={{ color: "var(--bad)", fontSize: "0.75rem" }}>
                        {deptStatus === "forbidden" ? tr("deptForbidden") : tr("deptLoadFailed")}
                      </span>
                      {deptStatus === "error" && (
                        <Button type="button" variant="ghost" style={{ fontSize: 12 }} onClick={() => setReloadKey((k) => k + 1)}>{tr("retry")}</Button>
                      )}
                    </div>
                  ) : (
                    <Select
                      value={toDeptId}
                      onChange={(e) => setToDeptId(e.target.value)}
                      disabled={deptStatus === "loading"}
                    >
                      <option value="">{deptStatus === "loading" ? tr("loadingDepts") : tr("selectDest")}</option>
                      {departments.filter((d) => d.id !== fromDept?.id).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label={tr("effectiveDate")} required error={fieldErrors.effectiveDate}>
                  <Input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </Field>

                <Field label={tr("payStructure")}>
                  <Select
                    value={payStructureId}
                    onChange={(e) => setPayStructureId(e.target.value)}
                    disabled={payStructureStatus === "loading"}
                  >
                    <option value="">{tr("noChange")}</option>
                    {payStructures.map((ps) => (
                      <option key={ps.id} value={ps.id}>{ps.name ?? ps.code ?? ps.id}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>{tr("cancel")}</Button>
                <Button style={{ minHeight: 44 }} disabled={deptStatus !== "ok" || employeeDeptResolving} onClick={() => validateStep1() && setStep(2)}>
                  {tr("next")}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              {submittedTransferId && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--warnbg)", borderRadius: 8, border: "1px solid var(--warnbd)" }}>
                  {tr("alreadyCreated")}
                </div>
              )}
              {employeeId && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--infobg)", borderRadius: 8, border: "1px solid var(--infobd)" }}>
                  <strong>{employeeLabel || tr("unknown")}</strong> → {toDeptName}
                  {effectiveDate && <> · {tr("effectiveOn", { date: effectiveDate })}</>}
                </div>
              )}

              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                {tr("step2Intro")}
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <Field label={tr("initiator")} required error={fieldErrors.initiatedBy}>
                  <Input readOnly value={self?.label ?? ""} placeholder={tr("loadingOfficers")} />
                </Field>

                <Field label={tr("approver")} required error={fieldErrors.currentWith}>
                  <EmployeePicker
                    value={currentWith || null}
                    onChange={(id) => setCurrentWith(id ?? "")}
                    placeholder={tr("selectApprover")}
                  />
                </Field>
              </div>

              <Field label={tr("note")} required error={fieldErrors.note}>
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={tr("notePlaceholder")}
                  style={{ resize: "vertical" }}
                />
              </Field>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Button variant="ghost" onClick={() => setStep(1)}>{tr("back")}</Button>
                <Button style={{ minHeight: 44 }} disabled={saving} loading={saving} onClick={() => void submit()}>
                  {saving ? tr("raising") : tr("submit")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
