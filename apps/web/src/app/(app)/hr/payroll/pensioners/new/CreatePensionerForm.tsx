"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../../../_components/ds";

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Matches the shared design-system look used by sibling HR/payroll forms
// (RequestAdvanceForm, TravelRequestForm, CreateFlexPlanForm, …) instead of
// hardcoded Tailwind slate/indigo classes, which rendered visually
// inconsistent with the rest of the app (different border/focus colors, and
// not theme-aware since --line/--ink etc. were bypassed).
const inputStyle: CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--line)", minHeight: 44, fontSize: 14,
};
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 };

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
  const formError = useFormError("pensioner");

  const ppoFieldId = useId();
  const nameFieldId = useId();
  const dobFieldId = useId();
  const basicFieldId = useId();
  const commutedFieldId = useId();
  const commDateFieldId = useId();
  const medFieldId = useId();
  const ddoFieldId = useId();
  const bankAccFieldId = useId();
  const ifscFieldId = useId();
  const panFieldId = useId();
  const taxRegimeId = useId();
  const statusMsgId = useId();

  function toMinorUnits(rupees: string): number {
    const val = parseFloat(rupees);
    if (Number.isNaN(val)) return 0;
    return Math.round(val * 100);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!ppoNo.trim() || !fullName.trim() || !dateOfBirth) {
      setStatus("error");
      setMessage(t("requiredError"));
      return;
    }

    if (pan.trim() && !PAN_REGEX.test(pan.trim().toUpperCase())) {
      setStatus("error");
      setMessage(t("panFormatError"));
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/payroll/pensioners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ppoNo: ppoNo.trim(),
          fullName: fullName.trim(),
          dateOfBirth,
          basicPensionMinor: toMinorUnits(basicPension),
          commutedPensionMinor: commutedPension ? toMinorUnits(commutedPension) : 0,
          commutationDate: commutationDate || undefined,
          medicalAllowanceMinor: medicalAllowance ? toMinorUnits(medicalAllowance) : 0,
          ddoCode: ddoCode.trim() || undefined,
          bankAccountNo: bankAccountNo.trim() || undefined,
          bankIfsc: bankIfsc.trim() || undefined,
          pan: pan.trim().toUpperCase() || undefined,
          taxRegime,
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message);
        return;
      }

      setStatus("success");
      setMessage(t("successMessage"));
      router.push("/hr/payroll/pensioners");
    } catch {
      setStatus("error");
      setMessage(formError.fromException("save").message);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <form onSubmit={handleSubmit} className="pad" style={{ display: "grid", gap: 16 }}>
        <div>
          <label htmlFor={ppoFieldId} style={labelStyle}>
            {t("ppoNoLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
          </label>
          <input
            id={ppoFieldId}
            type="text"
            value={ppoNo}
            onChange={(e) => setPpoNo(e.target.value)}
            placeholder={t("ppoNoPlaceholder")}
            style={inputStyle}
            required
          />
        </div>

        <div>
          <label htmlFor={nameFieldId} style={labelStyle}>
            {t("fullNameLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
          </label>
          <input
            id={nameFieldId}
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("fullNamePlaceholder")}
            style={inputStyle}
            required
          />
        </div>

        <div>
          <label htmlFor={dobFieldId} style={labelStyle}>
            {t("dobLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
          </label>
          <input
            id={dobFieldId}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div>
            <label htmlFor={basicFieldId} style={labelStyle}>{t("basicPensionLabel")}</label>
            <input
              id={basicFieldId}
              type="number"
              min="0"
              step="0.01"
              value={basicPension}
              onChange={(e) => setBasicPension(e.target.value)}
              placeholder={t("basicPensionPlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={commutedFieldId} style={labelStyle}>{t("commutedPensionLabel")}</label>
            <input
              id={commutedFieldId}
              type="number"
              min="0"
              step="0.01"
              value={commutedPension}
              onChange={(e) => setCommutedPension(e.target.value)}
              placeholder={t("commutedPensionPlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={commDateFieldId} style={labelStyle}>{t("commutationDateLabel")}</label>
            <input
              id={commDateFieldId}
              type="date"
              value={commutationDate}
              onChange={(e) => setCommutationDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={medFieldId} style={labelStyle}>{t("medicalAllowanceLabel")}</label>
            <input
              id={medFieldId}
              type="number"
              min="0"
              step="0.01"
              value={medicalAllowance}
              onChange={(e) => setMedicalAllowance(e.target.value)}
              placeholder={t("medicalAllowancePlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={ddoFieldId} style={labelStyle}>{t("ddoCodeLabel")}</label>
            <input
              id={ddoFieldId}
              type="text"
              value={ddoCode}
              onChange={(e) => setDdoCode(e.target.value)}
              placeholder={t("ddoCodePlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={bankAccFieldId} style={labelStyle}>{t("bankAccountLabel")}</label>
            <input
              id={bankAccFieldId}
              type="text"
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
              placeholder={t("bankAccountPlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={ifscFieldId} style={labelStyle}>{t("ifscLabel")}</label>
            <input
              id={ifscFieldId}
              type="text"
              value={bankIfsc}
              onChange={(e) => setBankIfsc(e.target.value)}
              placeholder={t("ifscPlaceholder")}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor={panFieldId} style={labelStyle}>{t("panLabel")}</label>
            <input
              id={panFieldId}
              type="text"
              value={pan}
              onChange={(e) => setPan(e.target.value)}
              placeholder={t("panPlaceholder")}
              maxLength={10}
              style={inputStyle}
            />
          </div>
        </div>

        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>{t("taxRegimeLegend")}</legend>
          <div style={{ display: "flex", gap: 24 }} id={taxRegimeId}>
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
            id={statusMsgId}
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
    </div>
  );
}
