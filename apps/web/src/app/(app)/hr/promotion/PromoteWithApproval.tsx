"use client";

/**
 * Promotion-with-eOffice-approval — two-step wizard.
 *
 * Step 1: Select employee + new designation  Step 2: Approval routing + justification
 *
 * GAP-HR-PROMOTION-05: employee/designation/initiating-officer/approving-
 * officer are now EntityPicker-backed searchable pickers (employee search is
 * real server-side search via GET /v1/hrms/employees?q=; designation and
 * officer pickers fetch their existing small, bounded lists once and filter
 * client-side -- see lib/entityAdapters/{designation,identityUser}.ts's own
 * comments for why that's the right shape for those two, same reasoning as
 * the pre-existing payStructure.ts adapter). Previously: three separate
 * `limit=200` fetches into plain <select>s (a tenant past 200 of any of
 * these could never reach the rest), with a silent raw-ID text-input
 * fallback whenever a fetch failed -- removed below in favour of an inline
 * error + Retry, since a bare UUID input invites a copy-pasted or typo'd id
 * with zero validation.
 *
 * "Current designation" is now looked up via the employee detail endpoint
 * (GET /v1/hrms/employees/:id) once an employee is selected, and shown as
 * read-only text. NOTE: this is a display-only lookup -- neither this
 * endpoint nor the employee list/search endpoints expose the employee's
 * designationId (only its resolved *name*), so `fromDesigId` in the submit
 * body stays undefined here exactly as it already did before this change
 * (employee/consumer.ts's submitPromotionForApproval handler already treats
 * it as optional, `p.fromDesigId ?? null` -- this was not a working,
 * regressed feature, just an already-absent one; inventing a new endpoint
 * to resolve it is out of this GAP's scope).
 */

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/app/_components/ds/Toast";
import { Button, Field, Input, Textarea, EntityPicker, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { searchDesignations, resolveDesignations } from "@/lib/entityAdapters/designation";
import { useFormError } from "@/lib/useFormError";
import { useSelfEmployee } from "@/app/_components/useSelfEmployee";

function todayIsoIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// GAP-HR-PROMOTION-05: no formal policy decision on back-dated / far-future
// effective dates was found (not a `Needs: decision` item, and the Day-0
// decision packet doesn't cover it) -- back-dating is normal for government
// promotion orders (the observation's own words), so only an implausibly
// far-future date is treated as a likely data-entry error and blocked; a
// past date gets a non-blocking notice instead of a hard stop.
const MAX_FUTURE_YEARS = 3;

export function PromoteWithApproval() {
  const t = useTranslations("promotionApprove");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const formError = useFormError("promotion");

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [currentDesignation, setCurrentDesignation] = useState<string | null>(null);
  const [currentDesignationLoading, setCurrentDesignationLoading] = useState(false);
  const [toDesigId, setToDesigId] = useState<string | null>(null);
  const [toDesigName, setToDesigName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [orderRef, setOrderRef] = useState("");
  // The initiating officer is always the signed-in employee (the estab route rejects any other initiator).
  const self = useSelfEmployee(open);
  const initiatedBy = self?.id ?? null;
  const [currentWith, setCurrentWith] = useState<string | null>(null);
  const [approverName, setApproverName] = useState("");
  const [note, setNote] = useState("");
  type FieldKey = "employeeId" | "toDesigId" | "effectiveDate" | "initiatedBy" | "currentWith" | "note";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  // Set once step 1 (create the pending_approval promotion request) succeeds.
  // Retrying after a step-2 (eFile) failure must resume from here instead of
  // re-running step 1 — submit-approval has no idempotency key, so restarting
  // from step 1 on every retry created a brand-new duplicate promotion
  // request for the same employee each time the eFile step failed.
  const [submittedPromotionId, setSubmittedPromotionId] = useState<string | null>(null);

  const reset = () => {
    setEmployeeId(null); setEmployeeName(""); setCurrentDesignation(null);
    setToDesigId(null); setToDesigName("");
    setEffectiveDate(""); setOrderRef(""); setCurrentWith(null);
    setApproverName(""); setNote(""); setFieldErrors({});
    setSubmittedPromotionId(null);
    setStep(1);
  };

  // GAP-HR-PROMOTION-05: current-designation display only -- see file header
  // comment on why this can't populate fromDesigId.
  useEffect(() => {
    if (!employeeId) { setCurrentDesignation(null); return; }
    let cancelled = false;
    setCurrentDesignationLoading(true);
    fetch(`/api/proxy/v1/hrms/employees/${employeeId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { designation?: string } | null) => {
        if (cancelled) return;
        setCurrentDesignation(body?.designation ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentDesignation(null);
      })
      .finally(() => {
        if (!cancelled) setCurrentDesignationLoading(false);
      });
    return () => { cancelled = true; };
  }, [employeeId]);

  // Display-name lookups for the step-2 summary box and the confirm-dialog
  // title. NOTE: these do NOT reuse EntityPicker's own `resolve` prop for
  // this -- that prop only fires to pre-populate a label for a `value` the
  // picker hasn't already seen (e.g. an id seeded from previously saved
  // data), not on a fresh interactive search-and-select, where the picker's
  // own internal state already has the label the instant the user clicks a
  // result. An earlier version of this file wired `resolve` to also set
  // this component's own name state, which therefore silently never ran in
  // the actual "create a new promotion" flow this wizard exists for (only
  // in an edit-existing-value scenario this component doesn't have) --
  // caught by PromoteWithApproval.test.tsx exercising the real
  // search-and-select interaction, not a pre-seeded value.
  useEffect(() => {
    if (!employeeId) { setEmployeeName(""); return; }
    let cancelled = false;
    resolveEmployees([employeeId]).then((opts) => {
      if (!cancelled && opts[0]) setEmployeeName(opts[0].label);
    }).catch(() => { /* leave showing the id fallback */ });
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => {
    if (!toDesigId) { setToDesigName(""); return; }
    let cancelled = false;
    resolveDesignations([toDesigId]).then((opts) => {
      if (!cancelled && opts[0]) setToDesigName(opts[0].label);
    }).catch(() => { /* leave showing the id fallback */ });
    return () => { cancelled = true; };
  }, [toDesigId]);

  useEffect(() => {
    if (!currentWith) { setApproverName(""); return; }
    let cancelled = false;
    resolveEmployees([currentWith]).then((opts) => {
      if (!cancelled && opts[0]) setApproverName(opts[0].label);
    }).catch(() => { /* leave showing the fallback */ });
    return () => { cancelled = true; };
  }, [currentWith]);

  const validateStep1 = (): boolean => {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!employeeId) errs.employeeId = t("errSelectEmployee");
    if (!toDesigId) errs.toDesigId = t("errSelectDesignation");
    if (!effectiveDate) {
      errs.effectiveDate = t("errEffectiveDateRequired");
    } else {
      const max = new Date();
      max.setFullYear(max.getFullYear() + MAX_FUTURE_YEARS);
      if (effectiveDate > max.toISOString().slice(0, 10)) errs.effectiveDate = t("errEffectiveDateTooFar");
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = (): boolean => {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!initiatedBy) errs.initiatedBy = t("errInitiatorUnknown");
    if (!currentWith) errs.currentWith = t("errSelectApprover");
    else if (currentWith === initiatedBy) errs.currentWith = t("errInitiatorEqualsApprover");
    if (note.trim().length < 3) errs.note = t("errJustificationNote");
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const doSubmit = useCallback(async () => {
    setSaving(true);
    try {
      const reqBody: { fromDesigId?: string; toDesigId: string; effectiveDate: string; orderRef?: string } = {
        toDesigId: toDesigId as string, effectiveDate,
      };
      if (orderRef.trim()) reqBody.orderRef = orderRef.trim();

      let promotionId = submittedPromotionId;
      if (!promotionId) {
        const subRes = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/promotion/submit-approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!subRes.ok) {
          const resolved = await formError.fromResponse(subRes, "save");
          throw UserFacingError.from(resolved);
        }
        const sub = (await subRes.json()) as { id?: string };
        if (!sub.id) throw new Error(t("errMissingIdFallback"));
        promotionId = sub.id;
        setSubmittedPromotionId(promotionId);
      }

      // NOTE (UX-017 scope note): `subject` below is composed for a
      // downstream backend record (the estab eFile-noting service), not
      // rendered as page UI at submission time -- left in English as a
      // data-contract concern (a mixed-locale subject line would read worse
      // than a consistent one, and this app has no i18n story yet for the
      // estab module that stores/searches it), not a UI string in this
      // tranche's scope.
      const raiseRes = await fetch("/api/proxy/v1/estab/files/from-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refType: "hr_promotion",
          refId: promotionId,
          subject: `Promotion order — ${employeeName || employeeId?.slice(0, 8)}`,
          dept: "HR",
          classification: "confidential",
          priority: "normal",
          initiatedBy,
          currentWith,
          approvalChain: "file_noting",
          initialNote: note.trim(),
          context: { employeeId, toDesigId, effectiveDate },
        }),
      });
      if (!raiseRes.ok) {
        const resolved = await formError.fromResponse(raiseRes, "save");
        throw UserFacingError.from(resolved);
      }
      const file = (await raiseRes.json()) as { fileNo?: string };
      toast.success(
        file.fileNo
          ? t("raisedToastWithFile", { fileNo: file.fileNo })
          : t("raisedToastNoFile"),
      );
      reset();
      setOpen(false);
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, employeeName, toDesigId, effectiveDate, orderRef, initiatedBy, currentWith, note, submittedPromotionId, toast, t, formError]);

  // GAP-HR-PROMOTION-03: a confidential eFile action had no confirmation
  // step at all -- the submit button went straight to submit(). This
  // doesn't change who's authorized (the backend already enforces HR_ROLES
  // on submit-approval; see GAP-HR-PROMOTION-03's own note that
  // maker!=checker doesn't apply here, the eFile approver is a separate,
  // later decision by them, not this dialog) -- it only adds the missing
  // "are you sure" step before an irreversible, confidential action.
  const { open: confirmOpen, busy: confirmBusy, error: confirmError, trigger: triggerSubmit, cancel: cancelSubmit, confirm: doConfirmSubmit } =
    useConfirmAction({
      onConfirm: async () => {
        await doSubmit();
      },
    });

  return (
    <>
      <Button onClick={() => { if (open) reset(); setOpen((v) => !v); }}>
        {open ? t("cancelToggleBtn") : t("openBtn")}
      </Button>

      {open && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>{t("heading")}</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--ink2)" }}>{t("stepIndicator", { step })}</span>
          </div>

          {step === 1 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                {t("step1Intro")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <Field label={t("employeeLabel")} required error={fieldErrors.employeeId}>
                  <EntityPicker
                    value={employeeId}
                    onChange={(v) => {
                      const id = Array.isArray(v) ? (v[0] ?? null) : v;
                      setEmployeeId(id);
                      if (!id) setEmployeeName("");
                    }}
                    search={searchEmployees}
                    resolve={resolveEmployees}
                    placeholder={t("selectEmployeeOption")}
                  />
                </Field>

                <Field label={t("currentDesignationLabel")} disabled>
                  <Input
                    value={currentDesignationLoading ? t("designationIdLoadingPlaceholder") : (currentDesignation ?? "")}
                    disabled
                    readOnly
                    style={{ color: "var(--ink2)" }}
                    aria-label={t("currentDesignationAutoFilledAria")}
                  />
                </Field>

                <Field label={t("promoteToLabel")} required error={fieldErrors.toDesigId}>
                  <EntityPicker
                    value={toDesigId}
                    onChange={(v) => {
                      const id = Array.isArray(v) ? (v[0] ?? null) : v;
                      setToDesigId(id);
                      if (!id) setToDesigName("");
                    }}
                    search={searchDesignations}
                    resolve={resolveDesignations}
                    placeholder={t("selectDesignationOption")}
                  />
                </Field>

                <div style={{ display: "grid", gap: 4 }}>
                  <Field label={t("effectiveDateLabel")} required error={fieldErrors.effectiveDate}>
                    <Input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                    />
                  </Field>
                  {effectiveDate && effectiveDate < todayIsoIST() && (
                    <span style={{ fontSize: "0.75rem", color: "var(--warn, #b45309)" }}>{t("effectiveDateBackdatedNotice")}</span>
                  )}
                </div>

                <Field label={t("orderRefLabel")}>
                  <Input
                    value={orderRef}
                    placeholder={t("orderRefPlaceholder")}
                    onChange={(e) => setOrderRef(e.target.value)}
                  />
                </Field>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>{t("cancelBtn")}</Button>
                <Button style={{ minHeight: 44 }} onClick={() => validateStep1() && setStep(2)}>
                  {t("nextStepBtn")}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pad" style={{ display: "grid", gap: 16 }}>
              {submittedPromotionId && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--warnbg, #fffbeb)", borderRadius: 8, border: "1px solid var(--warnbd, #fde68a)" }}>
                  {t("resumeNotice")}
                </div>
              )}
              {employeeId && (
                <div style={{ fontSize: "0.8125rem", padding: "10px 14px", background: "var(--goodbg, #f0fdf4)", borderRadius: 8, border: "1px solid var(--goodbd, #bbf7d0)" }}>
                  <strong>{employeeName || employeeId}</strong>: {currentDesignation ?? "—"} → {toDesigName || toDesigId}
                  {effectiveDate && <> · {t("effectiveOn", { date: effectiveDate })}</>}
                </div>
              )}

              <p style={{ fontSize: "0.8125rem", color: "var(--ink2)", margin: 0 }}>
                {t("step2Intro")}
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <Field label={t("initiatingOfficerLabel")} required error={fieldErrors.initiatedBy}>
                  <Input readOnly value={self?.label ?? ""} />
                </Field>

                <Field label={t("forwardToLabel")} required error={fieldErrors.currentWith}>
                  <EntityPicker
                    value={currentWith}
                    onChange={(v) => {
                      const id = Array.isArray(v) ? (v[0] ?? null) : v;
                      setCurrentWith(id);
                    }}
                    search={searchEmployees}
                    resolve={resolveEmployees}
                    placeholder={t("selectApproverOption")}
                  />
                </Field>
              </div>

              <Field label={t("justificationNoteLabel")} required error={fieldErrors.note}>
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("justificationPlaceholder")}
                  style={{ resize: "vertical" }}
                />
              </Field>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Button variant="ghost" onClick={() => setStep(1)}>{t("backBtn")}</Button>
                <Button style={{ minHeight: 44 }} disabled={saving} loading={saving} onClick={() => validateStep2() && triggerSubmit()}>
                  {saving ? t("raisingBtn") : t("submitBtn")}
                </Button>
              </div>

              <ConfirmDialog
                open={confirmOpen}
                title={t("confirmRaiseTitle", { approver: approverName || t("selectApproverOption") })}
                description={t("confirmRaiseDescription")}
                confirmLabel={t("confirmRaiseConfirmBtn")}
                busy={confirmBusy}
                errorMessage={confirmError}
                onConfirm={() => void doConfirmSubmit()}
                onCancel={cancelSubmit}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
