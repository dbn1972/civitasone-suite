"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, type EntityOption, Input, Select } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { validateLoanForm, type LoanFormErrorCode, type LoanFormField } from "./loanFormValidation";

const ERROR_KEYS: Record<LoanFormErrorCode, string> = {
  required: "requiredError",
  amountInvalid: "amountInvalidError",
  amountTooLarge: "amountTooLargeError",
  tenureInvalid: "tenureInvalidError",
  rateInvalid: "rateInvalidError",
  emiTooLow: "emiTooLowError",
};

const FIELD_ORDER: LoanFormField[] = ["loanNo", "employeeId", "principal", "emi", "tenure", "interestRate"];


function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param currentEmpId the employee whose loans the page is showing (?empId).
 *   After a successful create the page navigates to the new loan's
 *   employee (GAP-PAYROLL-LOANS-05) -- or just refreshes when it is the same.
 */
export function CreateLoanForm({ currentEmpId = "" }: { currentEmpId?: string }) {
  const t = useTranslations("createLoanForm");
  const tv = useTranslations("hrFormErrors2");
  const router = useRouter();
  const [loanNo, setLoanNo] = useState("");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EntityOption | null>(null);
  const [loanType, setLoanType] = useState("personal");
  const [principalRupees, setPrincipalRupees] = useState("");
  const [emiRupees, setEmiRupees] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoanFormField, LoanFormErrorCode>>>({});
  const idempotencyKeyRef = useRef<string>("");

  const loanNoField = useId();
  const empIdField = useId();
  const typeField = useId();
  const principalField = useId();
  const emiField = useId();
  const tenureField = useId();
  const rateField = useId();
  const errId = useId();

  const fieldIds: Record<LoanFormField, string> = {
    loanNo: loanNoField,
    employeeId: empIdField,
    principal: principalField,
    emi: emiField,
    tenure: tenureField,
    interestRate: rateField,
  };

  const validation = validateLoanForm({ loanNo, employeeId, principalRupees, emiRupees, tenureMonths, interestRatePct });

  function clearFieldError(field: LoanFormField) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  // Inline copy per field; the generic "required" sentence stays in the summary line only.
  const fe = (f: LoanFormField) => {
    const code = fieldErrors[f];
    if (!code) return undefined;
    return code === "required" ? tv("fieldRequired") : t(ERROR_KEYS[code]);
  };

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      const codes = new Set(Object.values(validation.errors));
      setError(codes.has("required") ? t(ERROR_KEYS.required) : undefined);
      const first = FIELD_ORDER.find((f) => validation.errors[f]);
      if (first) document.getElementById(fieldIds[first])?.focus();
      return;
    }
    setFieldErrors({});
    idempotencyKeyRef.current = newIdempotencyKey();
    setConfirmOpen(true);
  }

  async function createLoan() {
    if (!validation.ok) return;
    const v = validation.value;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/loans", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKeyRef.current },
        body: JSON.stringify({
          ...(v.loanNo ? { loanNo: v.loanNo } : {}),
          employeeId: v.employeeId,
          loanType,
          // Bounded by MAX_LOAN_MONEY_MINOR (1e10) -- well inside
          // Number.MAX_SAFE_INTEGER; the API's zod schema takes a JSON int.
          principalMinor: Number(v.principalMinor),
          emiMinor: Number(v.emiMinor),
          tenureMonths: v.tenureMonths,
          interestRatePct: v.interestRatePct,
          currency: "INR",
        }),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "LOAN_NO_TAKEN") {
          setFieldErrors({ loanNo: "required" });
          throw new Error(t("loanNoTakenError", { loanNo: v.loanNo ?? "" }));
        }
        throw new Error(await errorMessageFromResponse(res));
      }
      setConfirmOpen(false);
      setMessage(v.loanNo
        ? t("submittedMessage", { loanNo: v.loanNo, employee: employee?.label ?? "" })
        : t("submittedMessageAuto", { employee: employee?.label ?? "" }));
      setLoanNo("");
      setEmployeeId(null);
      setEmployee(null);
      setPrincipalRupees("");
      setEmiRupees("");
      setTenureMonths("");
      setInterestRatePct("0");
      if (v.employeeId === currentEmpId) {
        router.refresh();
      } else {
        router.push(`/hr/payroll/loans?empId=${encodeURIComponent(v.employeeId)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }} noValidate>
      <Card title={t("cardTitle")} padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <Field id={loanNoField} label={t("loanNoLabel")} error={fe("loanNo")}>
            <Input
              value={loanNo}
              onChange={(e) => { setLoanNo(e.target.value); clearFieldError("loanNo"); }}
              maxLength={64}
              aria-describedby={fieldErrors.loanNo ? `${loanNoField}-error` : `${loanNoField}-hint`}
            />
            <span id={`${loanNoField}-hint`} style={{ fontSize: 12, color: "var(--ink2)" }}>{t("loanNoHint")}</span>
          </Field>
          <Field
            id={empIdField}
            label={t("employeeLabel")}
            required
            error={fieldErrors.employeeId ? t("employeeRequiredError") : undefined}
          >
            <EmployeePicker
              directory="payroll"
              value={employeeId}
              onChange={(id, option) => {
                setEmployeeId(id);
                setEmployee(option);
                clearFieldError("employeeId");
              }}
            />
          </Field>
          <Field id={typeField} label={t("loanTypeLabel")}>
            <Select value={loanType} onChange={(e) => setLoanType(e.target.value)}>
              <option value="personal">{t("optionPersonal")}</option>
              <option value="vehicle">{t("optionVehicle")}</option>
              <option value="house_building">{t("optionHouseBuilding")}</option>
              <option value="festival">{t("optionFestival")}</option>
            </Select>
          </Field>
          <Field id={principalField} error={fe("principal")} label={t("principalLabel")} required>
            <Input
              inputMode="decimal"
              value={principalRupees}
              onChange={(e) => { setPrincipalRupees(e.target.value); clearFieldError("principal"); }}
            />
          </Field>
          <Field id={emiField} error={fe("emi")} label={t("emiLabel")} required>
            <Input
              inputMode="decimal"
              value={emiRupees}
              onChange={(e) => { setEmiRupees(e.target.value); clearFieldError("emi"); }}
            />
          </Field>
          <Field id={tenureField} error={fe("tenure")} label={t("tenureLabel")} required>
            <Input
              inputMode="numeric"
              value={tenureMonths}
              onChange={(e) => { setTenureMonths(e.target.value); clearFieldError("tenure"); }}
            />
          </Field>
          <Field id={rateField} error={fe("interestRate")} label={t("interestRateLabel")}>
            <Input
              inputMode="decimal"
              value={interestRatePct}
              onChange={(e) => { setInterestRatePct(e.target.value); clearFieldError("interestRate"); }}
            />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {t("submitButton")}
          </Button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={
          <>
            {t.rich(validation.ok && !validation.value.loanNo ? "confirmDescriptionAuto" : "confirmDescription", {
              loanNo: validation.ok ? validation.value.loanNo ?? "" : loanNo,
              employee: employee?.label ?? "",
              principal: validation.ok ? formatMoney(validation.value.principalMinor) : "",
              emi: validation.ok ? formatMoney(validation.value.emiMinor) : "",
              tenure: validation.ok ? validation.value.tenureMonths : 0,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {validation.ok && validation.warnings.emiAboveSimpleInterest && (
              // Advisory only (GAP-PAYROLL-LOANS-05): Confirm stays enabled.
              <span role="note" className="pill warn" style={{ display: "block", marginTop: 10, width: "fit-content" }}>
                {t("emiAboveInterestBoundWarning", {
                  total: formatMoney(validation.warnings.emiAboveSimpleInterest.totalMinor),
                  bound: formatMoney(validation.warnings.emiAboveSimpleInterest.boundMinor),
                })}
              </span>
            )}
          </>
        }
        onConfirm={() => void createLoan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
