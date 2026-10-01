"use client";

import { useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { browserFetch } from "@/lib/api/browserClient";
import { rupeesToMinorString, nonNegativeRupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate, todayIST } from "@/lib/formatters";
import { Button, ConfirmDialog, maskLast4 } from "../../../../../_components/ds";

// Same rules payroll-service's createPensionerBody enforces server-side
// (payroll/validators.ts) -- GAP-PAYROLL-PENSIONERS-NEW-02.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCOUNT_REGEX = /^\d{9,18}$/;

// Matches the shared design-system look used by sibling HR/payroll forms
// (RequestAdvanceForm, TravelRequestForm, CreateFlexPlanForm, …) instead of
// hardcoded Tailwind slate/indigo classes.
const inputStyle: CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--line)", minHeight: 44, fontSize: 14,
};
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 };

type FieldKey =
  | "ppoNo" | "fullName" | "dateOfBirth" | "basicPension" | "commutedPension" | "commutationDate"
  | "medicalAllowance" | "bankAccountNo" | "bankIfsc" | "pan";

type Payload = {
  ppoNo: string;
  fullName: string;
  dateOfBirth: string;
  basicPensionMinor: string;
  commutedPensionMinor: string;
  commutationDate?: string;
  medicalAllowanceMinor: string;
  ddoCode?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  pan?: string;
  taxRegime: "old" | "new";
};

function RequiredMark() {
  return <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>;
}

export function CreatePensionerForm() {
  const t = useTranslations("createPensionerForm");
  const router = useRouter();

  const [ppoNo, setPpoNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [basicPension, setBasicPension] = useState("");
  const [commutedPension, setCommutedPension] = useState("");
  const [commutationDate, setCommutationDate] = useState("");
  const [medicalAllowance, setMedicalAllowance] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [pan, setPan] = useState("");
  const [taxRegime, setTaxRegime] = useState<"old" | "new">("new");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState(null as FieldKey | null);
  // GAP-PAYROLL-PENSIONERS-NEW-02: validated payload awaiting confirmation.
  const [pending, setPending] = useState(null as Payload | null);
  const [dialogError, setDialogError] = useState(undefined as string | undefined);
  const formError = useFormError("pensioner");

  const ids = {
    ppoNo: useId(), fullName: useId(), dateOfBirth: useId(), basicPension: useId(), commutedPension: useId(),
    commutationDate: useId(), medicalAllowance: useId(), ddoCode: useId(), bankAccountNo: useId(),
    bankIfsc: useId(), pan: useId(), taxRegime: useId(), statusMsg: useId(), dpdpNotice: useId(),
  };
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});

  function fail(field: FieldKey, msgKey: string) {
    setStatus("error");
    setMessage(t(msgKey));
    setInvalidField(field);
    fieldRefs.current[field]?.focus();
  }

  function fieldA11y(field: FieldKey) {
    const invalid = invalidField === field;
    return {
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? ids.statusMsg : undefined,
    } as const;
  }

  /** Returns the validated payload, or null after flagging the first invalid field. */
  function validate(): Payload | null {
    const today = todayIST();
    if (!ppoNo.trim()) { fail("ppoNo", "requiredError"); return null; }
    if (!fullName.trim()) { fail("fullName", "requiredError"); return null; }
    if (!dateOfBirth) { fail("dateOfBirth", "requiredError"); return null; }
    // GAP-PAYROLL-PENSIONERS-NEW-01: DOB cannot be in the future.
    if (dateOfBirth > today) { fail("dateOfBirth", "dobFutureError"); return null; }

    // GAP-PAYROLL-PENSIONERS-NEW-01: basic pension is required and > 0. The
    // old toMinorUnits() turned a blank/NaN into 0, creating an "active"
    // pensioner at ₹0.00. String-based parsing -- no float rounding.
    const basicMinor = rupeesToMinorString(basicPension);
    if (!basicMinor) { fail("basicPension", "basicPensionError"); return null; }

    let commutedMinor = "0";
    if (commutedPension.trim()) {
      const parsed = nonNegativeRupeesToMinorString(commutedPension);
      if (parsed === null) { fail("commutedPension", "amountFormatError"); return null; }
      commutedMinor = parsed;
    }
    // GAP-PAYROLL-PENSIONERS-NEW-04: commuted amount and commutation date are
    // a pair -- both or neither.
    const hasCommutedAmount = BigInt(commutedMinor) > 0n;
    if (hasCommutedAmount && !commutationDate) { fail("commutationDate", "commutationPairError"); return null; }
    if (!hasCommutedAmount && commutationDate) { fail("commutedPension", "commutationPairError"); return null; }
    if (commutationDate && commutationDate < dateOfBirth) { fail("commutationDate", "commutationBeforeDobError"); return null; }
    if (commutationDate && commutationDate > today) { fail("commutationDate", "commutationFutureError"); return null; }

    let medicalMinor = "0";
    if (medicalAllowance.trim()) {
      const parsed = nonNegativeRupeesToMinorString(medicalAllowance);
      if (parsed === null) { fail("medicalAllowance", "amountFormatError"); return null; }
      medicalMinor = parsed;
    }

    // GAP-PAYROLL-PENSIONERS-NEW-02: bank/PAN format checks.
    const account = bankAccountNo.trim();
    const ifsc = bankIfsc.trim().toUpperCase();
    const panValue = pan.trim().toUpperCase();
    if (account && !BANK_ACCOUNT_REGEX.test(account)) { fail("bankAccountNo", "bankAccountFormatError"); return null; }
    if (ifsc && !IFSC_REGEX.test(ifsc)) { fail("bankIfsc", "ifscFormatError"); return null; }
    if (panValue && !PAN_REGEX.test(panValue)) { fail("pan", "panFormatError"); return null; }

    return {
      ppoNo: ppoNo.trim(),
      fullName: fullName.trim(),
      dateOfBirth,
      basicPensionMinor: basicMinor,
      commutedPensionMinor: commutedMinor,
      commutationDate: commutationDate || undefined,
      medicalAllowanceMinor: medicalMinor,
      ddoCode: ddoCode.trim() || undefined,
      bankAccountNo: account || undefined,
      bankIfsc: ifsc || undefined,
      pan: panValue || undefined,
      taxRegime,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalidField(null);
    setMessage("");
    setStatus("idle");
    const payload = validate();
    if (!payload) return;
    setDialogError(undefined);
    setPending(payload);
  }

  async function confirmCreate() {
    if (!pending) return;
    setStatus("submitting");
    setDialogError(undefined);
    try {
      // GAP-PAYROLL-PENSIONERS-NEW-03: browserFetch (not a bare fetch) so the
      // device-trust headers every other payroll form sends are included.
      const res = await browserFetch("v1/payroll/pensioners", {
        method: "POST",
        body: JSON.stringify(pending),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setDialogError(resolved.message);
        return;
      }
      setPending(null);
      setStatus("success");
      setMessage(t("successMessage"));
      router.push("/hr/payroll/pensioners");
      router.refresh();
    } catch {
      setStatus("error");
      setDialogError(formError.fromException("save").message);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <form onSubmit={handleSubmit} className="pad" style={{ display: "grid", gap: 16 }} noValidate>
        <div>
          <label htmlFor={ids.ppoNo} style={labelStyle}>
            {t("ppoNoLabel")} <RequiredMark />
          </label>
          <input
            id={ids.ppoNo}
            ref={(el) => { fieldRefs.current.ppoNo = el; }}
            type="text"
            value={ppoNo}
            onChange={(e) => setPpoNo(e.target.value)}
            placeholder={t("ppoNoPlaceholder")}
            style={inputStyle}
            required
            aria-required="true"
            {...fieldA11y("ppoNo")}
          />
        </div>

        <div>
          <label htmlFor={ids.fullName} style={labelStyle}>
            {t("fullNameLabel")} <RequiredMark />
          </label>
          <input
            id={ids.fullName}
            ref={(el) => { fieldRefs.current.fullName = el; }}
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("fullNamePlaceholder")}
            style={inputStyle}
            required
            aria-required="true"
            {...fieldA11y("fullName")}
          />
        </div>

        <div>
          <label htmlFor={ids.dateOfBirth} style={labelStyle}>
            {t("dobLabel")} <RequiredMark />
          </label>
          <input
            id={ids.dateOfBirth}
            ref={(el) => { fieldRefs.current.dateOfBirth = el; }}
            type="date"
            value={dateOfBirth}
            max={todayIST()}
            onChange={(e) => setDateOfBirth(e.target.value)}
            style={inputStyle}
            required
            aria-required="true"
            {...fieldA11y("dateOfBirth")}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div>
            <label htmlFor={ids.basicPension} style={labelStyle}>
              {t("basicPensionLabel")} <RequiredMark />
            </label>
            <input
              id={ids.basicPension}
              ref={(el) => { fieldRefs.current.basicPension = el; }}
              type="text"
              inputMode="decimal"
              value={basicPension}
              onChange={(e) => setBasicPension(e.target.value)}
              placeholder={t("basicPensionPlaceholder")}
              style={inputStyle}
              required
              aria-required="true"
              {...fieldA11y("basicPension")}
            />
          </div>

          <div>
            <label htmlFor={ids.commutedPension} style={labelStyle}>{t("commutedPensionLabel")}</label>
            <input
              id={ids.commutedPension}
              ref={(el) => { fieldRefs.current.commutedPension = el; }}
              type="text"
              inputMode="decimal"
              value={commutedPension}
              onChange={(e) => setCommutedPension(e.target.value)}
              placeholder={t("commutedPensionPlaceholder")}
              style={inputStyle}
              {...fieldA11y("commutedPension")}
            />
          </div>

          <div>
            <label htmlFor={ids.commutationDate} style={labelStyle}>{t("commutationDateLabel")}</label>
            <input
              id={ids.commutationDate}
              ref={(el) => { fieldRefs.current.commutationDate = el; }}
              type="date"
              value={commutationDate}
              min={dateOfBirth || undefined}
              max={todayIST()}
              onChange={(e) => setCommutationDate(e.target.value)}
              style={inputStyle}
              {...fieldA11y("commutationDate")}
            />
          </div>

          <div>
            <label htmlFor={ids.medicalAllowance} style={labelStyle}>{t("medicalAllowanceLabel")}</label>
            <input
              id={ids.medicalAllowance}
              ref={(el) => { fieldRefs.current.medicalAllowance = el; }}
              type="text"
              inputMode="decimal"
              value={medicalAllowance}
              onChange={(e) => setMedicalAllowance(e.target.value)}
              placeholder={t("medicalAllowancePlaceholder")}
              style={inputStyle}
              {...fieldA11y("medicalAllowance")}
            />
          </div>

          <div>
            <label htmlFor={ids.ddoCode} style={labelStyle}>{t("ddoCodeLabel")}</label>
            <input
              id={ids.ddoCode}
              type="text"
              value={ddoCode}
              onChange={(e) => setDdoCode(e.target.value)}
              placeholder={t("ddoCodePlaceholder")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* GAP-PAYROLL-PENSIONERS-NEW-02: sensitive bank/PAN group, with a
            DPDP purpose notice and autofill disabled. */}
        <fieldset aria-describedby={ids.dpdpNotice} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 14 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>{t("bankPanLegend")}</legend>
          <p id={ids.dpdpNotice} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("dpdpNotice")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div>
              <label htmlFor={ids.bankAccountNo} style={labelStyle}>{t("bankAccountLabel")}</label>
              <input
                id={ids.bankAccountNo}
                ref={(el) => { fieldRefs.current.bankAccountNo = el; }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                placeholder={t("bankAccountPlaceholder")}
                style={inputStyle}
                {...fieldA11y("bankAccountNo")}
              />
            </div>

            <div>
              <label htmlFor={ids.bankIfsc} style={labelStyle}>{t("ifscLabel")}</label>
              <input
                id={ids.bankIfsc}
                ref={(el) => { fieldRefs.current.bankIfsc = el; }}
                type="text"
                autoComplete="off"
                maxLength={11}
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                placeholder={t("ifscPlaceholder")}
                style={{ ...inputStyle, textTransform: "uppercase" }}
                {...fieldA11y("bankIfsc")}
              />
            </div>

            <div>
              <label htmlFor={ids.pan} style={labelStyle}>{t("panLabel")}</label>
              <input
                id={ids.pan}
                ref={(el) => { fieldRefs.current.pan = el; }}
                type="text"
                autoComplete="off"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder={t("panPlaceholder")}
                maxLength={10}
                style={{ ...inputStyle, textTransform: "uppercase" }}
                {...fieldA11y("pan")}
              />
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>{t("taxRegimeLegend")}</legend>
          <div style={{ display: "flex", gap: 24 }} id={ids.taxRegime}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="taxRegime"
                value="old"
                checked={taxRegime === "old"}
                onChange={() => setTaxRegime("old")}
                style={{ width: 18, height: 18 }}
              />
              {t("oldRegimeLabel")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="taxRegime"
                value="new"
                checked={taxRegime === "new"}
                onChange={() => setTaxRegime("new")}
                style={{ width: 18, height: 18 }}
              />
              {t("newRegimeLabel")}
            </label>
          </div>
        </fieldset>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={status === "submitting"}>
            {status === "submitting" ? t("submittingButton") : t("submitButton")}
          </Button>
        </div>

        {message && (
          <p
            id={ids.statusMsg}
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            className={`pill ${status === "error" ? "bad" : "good"}`}
            style={{ width: "fit-content" }}
          >
            <span style={{ fontWeight: 600 }}>{status === "error" ? t("errorPrefix") : t("successPrefix")}</span>
            {message}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={pending !== null}
        title={t("confirmTitle")}
        confirmLabel={t("submitButton")}
        busy={status === "submitting"}
        errorMessage={dialogError}
        description={
          pending ? (
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
              <dt>{t("ppoNoLabel")}</dt><dd style={{ margin: 0 }}><strong>{pending.ppoNo}</strong></dd>
              <dt>{t("fullNameLabel")}</dt><dd style={{ margin: 0 }}>{pending.fullName}</dd>
              <dt>{t("dobLabel")}</dt><dd style={{ margin: 0 }}>{formatIndianDate(pending.dateOfBirth)}</dd>
              <dt>{t("confirmBasicPension")}</dt><dd style={{ margin: 0 }}><strong>{formatMoney(pending.basicPensionMinor)}</strong></dd>
              {pending.bankAccountNo && (
                <>
                  <dt>{t("confirmBankAccount")}</dt><dd style={{ margin: 0, fontFamily: "monospace" }}>{maskLast4(pending.bankAccountNo)}</dd>
                </>
              )}
            </dl>
          ) : null
        }
        onConfirm={() => void confirmCreate()}
        onCancel={() => { if (status !== "submitting") { setPending(null); setStatus("idle"); } }}
      />
    </div>
  );
}
