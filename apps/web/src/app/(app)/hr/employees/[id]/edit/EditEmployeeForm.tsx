"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeDetail } from "@civitasone/types";
import { useFormError } from "@/lib/useFormError";
import { AcceptedNotice, Button, ConfirmDialog, EntityPicker, Field, Input, MaskedField } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { acceptedCopy } from "@/lib/acceptedCopy";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { searchPayStructures, resolvePayStructures } from "@/lib/entityAdapters/payStructure";
import { useTranslations } from "next-intl";
import { isIndianStateCode } from "@/lib/india/states";
import { WorkStateSelect } from "../../WorkStateSelect";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
// GAP-HR-EMPLOYEES-DETAIL-EDIT-02: a changed bank account must be plain digits
// (Indian accounts run 9-18) and an IFSC is 4 letters, a zero, then 6 letters or
// digits. Checked before anything is sent: a wrong number here misdirects pay.
const ACCOUNT_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// GAP-HR-EMPLOYEES-DETAIL-EDIT-03: kept in sync with hrms-service's
// validators.ts SENSITIVE_UPDATE_FIELDS (can't import across the service
// boundary). Any patch touching one of these needs a typed reason.
const SENSITIVE_FIELDS = ["bankAccountNo", "bankIfsc", "uanNumber", "esicIpNumber", "pran"] as const;

// GAP-HR-EMPLOYEES-DETAIL-EDIT-05: mirrors hrms-service's employee/status.ts
// EXITED_STATUSES exactly (not SERVING_STATUSES -- that set is scoped to the
// "Active" headcount stat and deliberately excludes on_leave/suspended too,
// which are temporary and still legitimate manager picks per that file's own
// comment). Duplicated, not imported, for the same cross-service-boundary
// reason as SENSITIVE_FIELDS above.
const MANAGER_INELIGIBLE_STATUSES = ["terminated", "separated", "retired"] as const;

interface Props {
  employee: EmployeeDetail;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--panel)",
  color: "var(--ink)",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink)",
};

export function EditEmployeeForm({ employee }: Props) {
  const t = useTranslations("employeeEdit");
  const tv = useTranslations("hrFormErrors2");
  const formId = useId();
  const router = useRouter();

  // GAP-HR-EMPLOYEES-DETAIL-EDIT-02: the API returns phone and bank account
  // already MASKED ("******7890"). A masked value is never seeded into an
  // editable input: it is shown read-only ("Current: ...") and the input starts
  // empty once the user chooses Change, so the only thing that can ever be
  // submitted is a value somebody deliberately typed.
  const rec = employee as Record<string, unknown>;
  const maskedOnly = (v: unknown): string | undefined => (typeof v === "string" && v.includes("*") ? v : undefined);
  const maskedPhone = maskedOnly(employee.phone);
  const maskedAccount = maskedOnly(rec.bankAccountNo);
  const initialMobile = maskedPhone ? "" : (employee.phone ?? "");
  const initialBankAccountNo = maskedAccount ? "" : ((rec.bankAccountNo as string | undefined) ?? "");

  const [mobile, setMobile] = useState(initialMobile);
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
  const [workStateCode, setWorkStateCode] = useState(employee.workStateCode ?? "");

  // Statutory & financial fields
  const [bankAccountNo, setBankAccountNo] = useState(initialBankAccountNo);
  const [confirmBankAccountNo, setConfirmBankAccountNo] = useState("");
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
  // field key -> its inline message (computed at submit time).
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const formError = useFormError("employee record");
  const accepted = useAcceptedWrite();

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
    workStateCode: `${formId}-workStateCode`,
    status: `${formId}-status`,
    bankAccountNo: `${formId}-bankAccountNo`,
    confirmBankAccountNo: `${formId}-confirmBankAccountNo`,
    bankIfsc: `${formId}-bankIfsc`,
    uanNumber: `${formId}-uanNumber`,
    esicIpNumber: `${formId}-esicIpNumber`,
    pran: `${formId}-pran`,
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // An accepted update is already on its way: never send a second one from
    // this form (Enter key, programmatic submit), whatever the button state.
    if (submitted || busy) return;
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
    const mobileChanged = trimmedMobile !== initialMobile;

    const errs: Record<string, string> = {};
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) errs.email = tv("emailInvalid");
    if (mobileChanged && trimmedMobile && !PHONE_RE.test(trimmedMobile)) errs.mobile = tv("mobileInvalid");

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
    // State of employment: sent only when changed to a real state / UT code (the API cannot clear it, like manager).
    if (workStateCode && workStateCode !== (employee.workStateCode ?? "")) {
      if (isIndianStateCode(workStateCode)) patch.workStateCode = workStateCode; else errs.workStateCode = t("workStateInvalid");
    }
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
      if (changed && value.includes("*")) errs[field] = t("noAsteriskError");
    }

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-02: shape checks on a CHANGED bank account / IFSC,
    // and a second typed entry of the account number that must match the first.
    if (bankAccountChanged && !errs.bankAccountNo) {
      const account = bankAccountNo.trim();
      if (!ACCOUNT_RE.test(account)) errs.bankAccountNo = t("bankAccountFormatError");
      else if (account !== confirmBankAccountNo.trim()) errs.confirmBankAccountNo = t("confirmAccountMismatch");
    }
    if (bankIfscChanged && !errs.bankIfsc && !IFSC_RE.test(bankIfsc.trim().toUpperCase())) {
      errs.bankIfsc = t("ifscFormatError");
    }

    if (Object.keys(errs).length > 0) {
      setInvalidFields(errs);
      setTone("error");
      setMessage(t("fixHighlightedFields"));
      return;
    }
    setInvalidFields({});

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
      // Nothing is "saving" any more -- `submitted` (not `busy`) is what keeps
      // Save/Cancel disabled, so the button stops reading "Saving…" forever.
      setBusy(false);
      setTone("success");
      setMessage(t("updateSubmitted"));
      // 202: no timed redirect that guesses the update has landed; the user continues from the notice.
      void accepted.accept();
    } catch (caught) {
      setTone("error");
      setMessage(formError.fromException("save", caught).message);
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
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
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
                background: tone === "success" ? "var(--goodbg)" : "var(--badbg)",
                border: `1px solid ${tone === "success" ? "var(--goodbd)" : "var(--badbd)"}`,
                color: tone === "success" ? "var(--good)" : "var(--bad)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>
        <AcceptedNotice
          {...accepted.noticeProps}
          // GAP-HR-EMPLOYEES-DETAIL-EDIT-06: ?updated=1 makes the profile fetch fresh
          // (no 60 s data-cache) and show a "changes are being applied" banner.
          onRefresh={() => { router.push(`/hr/employees/${employee.id}?updated=1`); router.refresh(); }}
          labels={{ refresh: acceptedCopy().continue }}
        />

        {/* Read-only summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--bg)",
            border: "1px solid var(--line)",
          }}
        >
          {[
            { label: t("roLabelEmployeeId"), value: employee.employeeId },
            { label: t("roLabelDepartment"), value: employee.department },
            { label: t("roLabelDesignation"), value: employee.designation },
            { label: t("roLabelStatus"), value: employee.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "var(--mut)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>
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
          <MaskedField
            id={ids.mobile}
            label={t("mobileLabel")}
            maskedValue={maskedPhone}
            value={mobile}
            onChange={setMobile}
            error={formError.fieldError("mobile") ?? invalidFields.mobile}
            currentLabel={t("currentValue", { value: maskedPhone ?? "" })}
            changeLabel={t("changeBtn")}
            keepLabel={t("keepCurrentBtn")}
            inputProps={{ type: "tel", placeholder: t("mobilePlaceholder"), autoComplete: "tel" }}
          />

          <Field id={ids.email} label={t("emailLabel")} error={formError.fieldError("email") ?? invalidFields.email}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              autoComplete="email"
            />
          </Field>

          <Field label={t("managerIdLabel")} error={formError.fieldError("managerId")}>
            <EntityPicker
              value={managerId}
              onChange={(v) => setManagerId(Array.isArray(v) ? (v[0] ?? null) : v)}
              // GAP-HR-EMPLOYEES-DETAIL-EDIT-05: GET /v1/hrms/employees
              // (repo.listByTenant) has no status filter and no self-
              // exclusion, so the manager picker could return a separated/
              // terminated/retired employee or the employee themself as an
              // option, breaking approval routing. Self-exclusion was already
              // client-side-only; the exited-status half is now closed the
              // same way via searchEmployees' excludeStatuses option
              // (entityAdapters/employee.ts), rather than widening the
              // shared, multi-caller directory endpoint's own query surface.
              // EDIT-05 (continued): excludeStatuses now also goes to the server
              // (GET /v1/hrms/employees?excludeStatuses=...), so the 20-row page
              // is never spent on people who cannot be chosen; `strict` makes a
              // failed lookup a visible "couldn't load" instead of "no matches".
              search={(q, signal) =>
                searchEmployees(q, signal, { excludeStatuses: MANAGER_INELIGIBLE_STATUSES, strict: true })
                  .then((opts) => opts.filter((o) => o.id !== employee.id))
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
              searchErrorText={t("pickerSearchError")}
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

          <div style={{ display: "grid", gap: 4 }}>
            <WorkStateSelect
              id={ids.workStateCode} value={workStateCode} onChange={setWorkStateCode}
              label={t("workStateLabel")} placeholder={t("selectWorkState")} hint={t("workStateHint")}
              style={inputStyle} labelStyle={labelStyle}
            />
            {invalidFields.workStateCode && <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{invalidFields.workStateCode}</span>}
          </div>
        </div>


        {/* Statutory & Financial Details */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--ink)" }}>
            {t("statutoryHeading")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            {/* GAP-HR-EMPLOYEES-DETAIL-EDIT-02: the account number comes back
                masked, so it is shown read-only and the input is empty until
                the user clicks Change; a changed number must be digits and be
                typed a second time. A leftover '*' (half-edited placeholder)
                is still caught client-side, and again by the API's validator. */}
            <MaskedField
              id={ids.bankAccountNo}
              label={t("bankAccountLabel")}
              maskedValue={maskedAccount}
              value={bankAccountNo}
              onChange={setBankAccountNo}
              error={invalidFields.bankAccountNo}
              currentLabel={t("currentValue", { value: maskedAccount ?? "" })}
              changeLabel={t("changeBtn")}
              keepLabel={t("keepCurrentBtn")}
              inputProps={{ type: "text", inputMode: "numeric", placeholder: t("bankAccountPlaceholder"), autoComplete: "off" }}
              onEditingChange={(editing) => { if (!editing) setConfirmBankAccountNo(""); }}
            >
              <Field id={ids.confirmBankAccountNo} label={t("confirmBankAccountLabel")} error={invalidFields.confirmBankAccountNo}>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={confirmBankAccountNo}
                  onChange={(e) => setConfirmBankAccountNo(e.target.value)}
                  placeholder={t("confirmBankAccountPlaceholder")}
                  autoComplete="off"
                />
              </Field>
            </MaskedField>
            <Field id={ids.bankIfsc} label={t("bankIfscLabel")} error={invalidFields.bankIfsc}>
              {/* GAP-HR-EMPLOYEES-DETAIL-EDIT-07: IFSC used to display
                  lowercase exactly as typed and only get uppercased in the
                  submit diff -- uppercase as-you-type instead, so what's
                  displayed always matches what gets sent. */}
              <Input
                type="text"
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                placeholder={t("bankIfscPlaceholder")}
                maxLength={11}
                autoComplete="off"
              />
            </Field>
            <Field id={ids.uanNumber} label={t("uanLabel")} error={invalidFields.uanNumber}>
              <Input
                type="text"
                value={uanNumber}
                onChange={(e) => setUanNumber(e.target.value)}
                placeholder={t("uanPlaceholder")}
                maxLength={12}
                autoComplete="off"
              />
            </Field>
            <Field id={ids.esicIpNumber} label={t("esicLabel")} error={invalidFields.esicIpNumber}>
              <Input
                type="text"
                value={esicIpNumber}
                onChange={(e) => setEsicIpNumber(e.target.value)}
                placeholder={t("esicPlaceholder")}
                autoComplete="off"
              />
            </Field>
            <Field id={ids.pran} label={t("pranLabel")} error={invalidFields.pran}>
              <Input
                type="text"
                value={pran}
                onChange={(e) => setPran(e.target.value)}
                placeholder={t("pranPlaceholder")}
                maxLength={12}
                autoComplete="off"
              />
            </Field>
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
