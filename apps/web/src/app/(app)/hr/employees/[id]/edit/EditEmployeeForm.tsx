"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeDetail } from "@civitasone/types";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker, Field } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { searchPayStructures, resolvePayStructures } from "@/lib/entityAdapters/payStructure";
import { useTranslations } from "next-intl";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

// GAP-HR-EMPLOYEES-DETAIL-EDIT-03: kept in sync with hrms-service's
// validators.ts SENSITIVE_UPDATE_FIELDS (can't import across the service
// boundary). Any patch touching one of these needs a typed reason.
const SENSITIVE_FIELDS = ["bankAccountNo", "bankIfsc", "uanNumber", "esicIpNumber", "pran"] as const;

interface Props {
  employee: EmployeeDetail;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};

export function EditEmployeeForm({ employee }: Props) {
  const t = useTranslations("employeeEdit");
  const formId = useId();
  const router = useRouter();

  const [mobile, setMobile] = useState(employee.phone ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  // GAP-HR-SF-06 (EntityPicker) / GAP-HR-EMPLOYEES-DETAIL-EDIT-04: seeded
  // from the real FK (managerId/payStructureId), not a display name. The
  // pre-conversion managerId state seeded itself from `employee.reportingTo`
  // (the manager's NAME) and only worked at all because the "did the user
  // actually change this" comparison below used that same name as its own
  // baseline; payStructureId seeded blank unconditionally, every visit,
  // because getEmployeeDetail never returned it (see queries.ts fix). Both
  // are real uuid columns and EntityPicker's resolve() needs a real id to
  // resolve a label for, not a name.
  const [managerId, setManagerId] = useState<string | null>(employee.managerId ?? null);
  const [payStructureId, setPayStructureId] = useState<string | null>(employee.payStructureId ?? null);

  // Statutory & financial fields
  const [bankAccountNo, setBankAccountNo] = useState((employee as Record<string,unknown>).bankAccountNo as string ?? "");
  const [bankIfsc, setBankIfsc] = useState((employee as Record<string,unknown>).bankIfsc as string ?? "");
  const [uanNumber, setUanNumber] = useState((employee as Record<string,unknown>).uanNumber as string ?? "");
  const [esicIpNumber, setEsicIpNumber] = useState((employee as Record<string,unknown>).esicIpNumber as string ?? "");
  const [pran, setPran] = useState((employee as Record<string,unknown>).pran as string ?? "");

  const [busy, setBusy] = useState(false);
  // GAP-HR-EMPLOYEES-DETAIL-EDIT-06: distinct from `busy` -- true from the
  // moment a save succeeds until the redirect actually fires, so Save/Cancel
  // stay disabled through the whole "Update submitted..." window instead of
  // re-enabling immediately (the old `finally { setBusy(false) }` did this
  // regardless of outcome), which let a second submit go out mid-redirect.
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("error");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const formError = useFormError("employee record");
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // GAP-HR-EMPLOYEES-DETAIL-EDIT-06: the redirect timeout was never cleared
  // on unmount (e.g. the user navigates away during the 1.2s window) --
  // harmless with router.push alone, but paired with router.refresh() it
  // could refresh a route the user is no longer on.
  useEffect(() => () => { if (redirectTimer.current) clearTimeout(redirectTimer.current); }, []);

  // GAP-HR-EMPLOYEES-DETAIL-EDIT-03: pending patch + confirm-dialog state
  // for the sensitive-field reason prompt (maker-checker per the published
  // decision packet's recommendation: reason + masked audit; a second-
  // approver step was left an open question there, not made a hard
  // requirement, so this is audit-only, no separate approver hop).
  const [pendingPatch, setPendingPatch] = useState<Record<string, string> | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  const ids = {
    mobile: `${formId}-mobile`,
    email: `${formId}-email`,
    managerId: `${formId}-managerId`,
    payStructureId: `${formId}-payStructureId`,
    status: `${formId}-status`,
    bankAccountNo: `${formId}-bankAccountNo`,
    bankIfsc: `${formId}-bankIfsc`,
    uanNumber: `${formId}-uanNumber`,
    esicIpNumber: `${formId}-esicIpNumber`,
    pran: `${formId}-pran`,
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimmedEmail = email.trim();
    const trimmedMobile = mobile.trim();
    // GAP-HR-EMPLOYEES-DETAIL-EDIT-02: mobile is seeded from the API's
    // already-masked value (pii-mask.ts, e.g. "******3210"); PHONE_RE has no
    // '*' in its character class, so an untouched masked phone failed this
    // check on EVERY save (even one only changing email), permanently
    // blocking the form with "fix highlighted fields" for any employee who
    // has a mobile on file. Only validate mobile when it was actually
    // changed -- exactly the same "don't re-validate what you're not
    // submitting" logic already applied to the masked bank/UAN/ESIC/PRAN
    // fields below.
    const mobileChanged = trimmedMobile !== (employee.phone ?? "");

    const errs = new Set<string>();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) errs.add("email");
    if (mobileChanged && trimmedMobile && !PHONE_RE.test(trimmedMobile)) errs.add("mobile");

    const patch: Record<string, string> = {};
    if (mobileChanged) patch.mobile = trimmedMobile;
    if (trimmedEmail !== (employee.email ?? "")) patch.email = trimmedEmail;
    // Clearing a manager/pay-structure back to "none" is not sent: both are
    // z.string().uuid().optional() server-side, which rejects an empty
    // string -- the pre-conversion code had this exact same limitation
    // (sending "" on clear would already have 400'd), so this preserves
    // behavior rather than introducing a new restriction.
    const initialManagerId = employee.managerId ?? null;
    const initialPayStructureId = employee.payStructureId ?? null;
    if (managerId && managerId !== initialManagerId) patch.managerId = managerId;
    if (payStructureId && payStructureId !== initialPayStructureId) patch.payStructureId = payStructureId;
    // Data-corruption fix: bankAccountNo/bankIfsc arrive here pre-masked by
    // the backend (pii-mask.ts maskValue -- "*******1234"), and this state
    // was seeded directly from that masked value above. A plain non-empty
    // check therefore always included the masked placeholder in the patch,
    // even when the user never touched the field -- silently overwriting the
    // real stored bank account/IFSC with asterisks on every save, for any
    // reason (e.g. just correcting the email). Compare against the original
    // (masked) prop value instead, same "was this actually edited" pattern
    // already used for mobile/email/managerId above, so an untouched field
    // is never submitted.
    const initialBankAccountNo = (employee as Record<string, unknown>).bankAccountNo as string ?? "";
    const initialBankIfsc = (employee as Record<string, unknown>).bankIfsc as string ?? "";
    const initialUan = (employee as Record<string, unknown>).uanNumber as string ?? "";
    const initialEsic = (employee as Record<string, unknown>).esicIpNumber as string ?? "";
    const initialPran = (employee as Record<string, unknown>).pran as string ?? "";
    const bankAccountChanged = bankAccountNo.trim() !== initialBankAccountNo;
    const bankIfscChanged = bankIfsc.trim().toUpperCase() !== initialBankIfsc.toUpperCase();
    const uanChanged = uanNumber.trim() !== initialUan;
    const esicChanged = esicIpNumber.trim() !== initialEsic;
    const pranChanged = pran.trim() !== initialPran;
    if (bankAccountChanged) patch.bankAccountNo = bankAccountNo.trim();
    if (bankIfscChanged) patch.bankIfsc = bankIfsc.trim().toUpperCase();
    if (uanChanged) patch.uanNumber = uanNumber.trim();
    if (esicChanged) patch.esicIpNumber = esicIpNumber.trim();
    if (pranChanged) patch.pran = pran.trim();

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-02: the backend's isMaskedValue guard
    // (commands.ts) only catches a value that is FULLY the masked shape
    // ("*******1234") -- a partially-edited string that still contains a
    // leftover '*' (e.g. editing "******7890" down to "1234*7890") does not
    // match that shape and would round-trip through as a real value,
    // corrupting the stored account number with a literal asterisk. Catch
    // any '*' in a CHANGED sensitive field here, client-side, before it's
    // ever sent.
    for (const [field, changed, value] of [
      ["bankAccountNo", bankAccountChanged, bankAccountNo] as const,
      ["bankIfsc", bankIfscChanged, bankIfsc] as const,
      ["uanNumber", uanChanged, uanNumber] as const,
      ["esicIpNumber", esicChanged, esicIpNumber] as const,
      ["pran", pranChanged, pran] as const,
    ]) {
      if (changed && value.includes("*")) errs.add(field);
    }

    if (errs.size > 0) {
      setInvalidFields(errs);
      setTone("error");
      setMessage(t("fixHighlightedFields"));
      return;
    }
    setInvalidFields(new Set());

    if (Object.keys(patch).length === 0) {
      setTone("error");
      setMessage(t("noChangesDetected"));
      return;
    }

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-03: bank account/IFSC/UAN/ESIC/PRAN route
    // salary and statutory credits -- require a typed reason (maker-checker,
    // audit-only per the published decision) before submitting, same as any
    // other sensitive-field change in this app.
    if (SENSITIVE_FIELDS.some((f) => patch[f] !== undefined)) {
      setPendingPatch(patch);
      setReasonError(undefined);
      return;
    }

    await doSubmit(patch);
  }

  async function doSubmit(patch: Record<string, string>, reason?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { ...patch, reason } : patch),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        setBusy(false);
        return;
      }

      // PATCH /v1/hrms/employees/:id returns 202 (queued command) -- the
      // update is being applied, not already confirmed done. `submitted`
      // (distinct from `busy`) keeps Save/Cancel disabled for the whole
      // window instead of re-enabling them immediately, which used to let a
      // second submit go out while the first was still "being applied".
      setSubmitted(true);
      setTone("success");
      setMessage(t("updateSubmitted"));
      redirectTimer.current = setTimeout(() => {
        router.push(`/hr/employees/${employee.id}`);
        router.refresh();
      }, 1200);
    } catch {
      setTone("error");
      setMessage(formError.fromException("save").message);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={t("formAriaLabel")}
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>{t("formHeading")}</h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut, #64748b)" }}>
          {t("formIntro")}
        </p>
      </div>

      <div className="pad" style={{ display: "grid", gap: 20 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={ids.status}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "var(--goodbg, #dcfce7)" : "var(--badbg, #fee2e2)",
                border: `1px solid ${tone === "success" ? "var(--goodbd, #86efac)" : "var(--badbd, #fca5a5)"}`,
                color: tone === "success" ? "var(--good, #166534)" : "var(--bad, #b91c1c)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        {/* Read-only summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--bg, #f8fafc)",
            border: "1px solid var(--line, #cbd5e1)",
          }}
        >
          {[
            { label: t("roLabelEmployeeId"), value: employee.employeeId },
            { label: t("roLabelDepartment"), value: employee.department },
            { label: t("roLabelDesignation"), value: employee.designation },
            { label: t("roLabelStatus"), value: employee.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "var(--mut, #64748b)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, color: "var(--ink, #0f172a)", fontWeight: 500 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Editable fields */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.mobile} style={labelStyle}>
              {t("mobileLabel")}
            </label>
            <input
              id={ids.mobile}
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder={t("mobilePlaceholder")}
              autoComplete="tel"
              aria-invalid={invalidFields.has("mobile")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("mobile")
                  ? "var(--bad, #ef4444)"
                  : "var(--line, #cbd5e1)",
              }}
            />
            {formError.fieldError("mobile") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("mobile")}</span>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.email} style={labelStyle}>
              {t("emailLabel")}
            </label>
            <input
              id={ids.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              autoComplete="email"
              aria-invalid={invalidFields.has("email")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("email")
                  ? "var(--bad, #ef4444)"
                  : "var(--line, #cbd5e1)",
              }}
            />
            {formError.fieldError("email") && (
              <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{formError.fieldError("email")}</span>
            )}
          </div>

          <Field label={t("managerIdLabel")} error={formError.fieldError("managerId")}>
            <EntityPicker
              value={managerId}
              onChange={(v) => setManagerId(Array.isArray(v) ? (v[0] ?? null) : v)}
              // GAP-HR-EMPLOYEES-DETAIL-EDIT-05 (backend-verify, confirmed
              // still real against current code): GET /v1/hrms/employees
              // (repo.listByTenant) has no status filter and no self-
              // exclusion, so the manager picker could return a separated/
              // terminated employee or the employee themself as an option.
              // The separated-employee half needs a backend status filter
              // whose blast radius on this generic, multi-caller directory
              // endpoint I did not want to change under time pressure (left
              // `[~]`, see PR description) -- self-exclusion is safe to do
              // here, client-side, with no backend change at all.
              search={(q, signal) =>
                searchEmployees(q, signal).then((opts) => opts.filter((o) => o.id !== employee.id))
              }
              resolve={resolveEmployees}
              initialOptions={
                employee.managerId && employee.reportingTo
                  ? [{ id: employee.managerId, label: employee.reportingTo }]
                  : undefined
              }
              placeholder={t("selectManagerPlaceholder")}
              searchingText={t("pickerSearching")}
              noResultsText={t("pickerNoResults")}
            />
          </Field>

          <Field label={t("payStructureIdLabel")} error={formError.fieldError("payStructureId")}>
            <EntityPicker
              value={payStructureId}
              onChange={(v) => setPayStructureId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchPayStructures}
              resolve={resolvePayStructures}
              placeholder={t("selectPayStructurePlaceholder")}
              searchingText={t("pickerSearching")}
              noResultsText={t("pickerNoResults")}
            />
          </Field>
        </div>


        {/* Statutory & Financial Details */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--ink)" }}>
            {t("statutoryHeading")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankAccountNo} style={labelStyle}>{t("bankAccountLabel")}</label>
              <input id={ids.bankAccountNo} type="text" value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                placeholder={t("bankAccountPlaceholder")}
                aria-invalid={invalidFields.has("bankAccountNo")}
                style={{ ...inputStyle, borderColor: invalidFields.has("bankAccountNo") ? "var(--bad, #ef4444)" : "var(--line, #cbd5e1)" }}
                autoComplete="off" />
              {/* GAP-HR-EMPLOYEES-DETAIL-EDIT-02: a leftover '*' means the
                  field still contains part of the masked placeholder it was
                  seeded with, not a real edited value -- caught client-side
                  before it's ever sent (the backend's isMaskedValue guard
                  only catches a FULLY-masked string, not a partial one). */}
              {invalidFields.has("bankAccountNo") && (
                <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{t("noAsteriskError")}</span>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankIfsc} style={labelStyle}>{t("bankIfscLabel")}</label>
              {/* GAP-HR-EMPLOYEES-DETAIL-EDIT-07: IFSC used to display
                  lowercase exactly as typed and only get uppercased in the
                  submit diff -- uppercase as-you-type instead, so what's
                  displayed always matches what gets sent. */}
              <input id={ids.bankIfsc} type="text" value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                placeholder={t("bankIfscPlaceholder")} maxLength={11}
                aria-invalid={invalidFields.has("bankIfsc")}
                style={{ ...inputStyle, textTransform: "uppercase", borderColor: invalidFields.has("bankIfsc") ? "var(--bad, #ef4444)" : "var(--line, #cbd5e1)" }}
                autoComplete="off" />
              {invalidFields.has("bankIfsc") && (
                <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{t("noAsteriskError")}</span>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.uanNumber} style={labelStyle}>{t("uanLabel")}</label>
              <input id={ids.uanNumber} type="text" value={uanNumber}
                onChange={(e) => setUanNumber(e.target.value)}
                placeholder={t("uanPlaceholder")} maxLength={12}
                aria-invalid={invalidFields.has("uanNumber")}
                style={{ ...inputStyle, borderColor: invalidFields.has("uanNumber") ? "var(--bad, #ef4444)" : "var(--line, #cbd5e1)" }}
                autoComplete="off" />
              {invalidFields.has("uanNumber") && (
                <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{t("noAsteriskError")}</span>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.esicIpNumber} style={labelStyle}>{t("esicLabel")}</label>
              <input id={ids.esicIpNumber} type="text" value={esicIpNumber}
                onChange={(e) => setEsicIpNumber(e.target.value)}
                placeholder={t("esicPlaceholder")}
                aria-invalid={invalidFields.has("esicIpNumber")}
                style={{ ...inputStyle, borderColor: invalidFields.has("esicIpNumber") ? "var(--bad, #ef4444)" : "var(--line, #cbd5e1)" }}
                autoComplete="off" />
              {invalidFields.has("esicIpNumber") && (
                <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{t("noAsteriskError")}</span>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.pran} style={labelStyle}>{t("pranLabel")}</label>
              <input id={ids.pran} type="text" value={pran}
                onChange={(e) => setPran(e.target.value)}
                placeholder={t("pranPlaceholder")} maxLength={12}
                aria-invalid={invalidFields.has("pran")}
                style={{ ...inputStyle, borderColor: invalidFields.has("pran") ? "var(--bad, #ef4444)" : "var(--line, #cbd5e1)" }}
                autoComplete="off" />
              {invalidFields.has("pran") && (
                <span style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>{t("noAsteriskError")}</span>
              )}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 12 }}>
            {t("statutoryNote")}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={submitted}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? t("savingBtn") : t("saveChangesBtn")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push(`/hr/employees/${employee.id}`)}
            disabled={busy || submitted}
            style={{ minHeight: 44 }}
          >
            {t("cancelBtn")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingPatch !== null}
        title={t("sensitiveConfirmTitle")}
        description={t("sensitiveConfirmDesc")}
        requireReason
        reasonLabel={t("sensitiveReasonLabel")}
        minReasonLength={10}
        confirmLabel={t("sensitiveConfirmBtn")}
        cancelLabel={t("cancelBtn")}
        busy={busy}
        errorMessage={reasonError}
        onConfirm={(reason) => {
          if (!pendingPatch) return;
          const patch = pendingPatch;
          setPendingPatch(null);
          void doSubmit(patch, reason);
        }}
        onCancel={() => {
          if (!busy) {
            setPendingPatch(null);
            setReasonError(undefined);
          }
        }}
      />
    </form>
  );
}
