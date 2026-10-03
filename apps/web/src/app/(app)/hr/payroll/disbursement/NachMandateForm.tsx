"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button, EntityPicker, type EntityOption } from "../../../../_components/ds";
import { browserJson, browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { searchPayrollEmployees, resolvePayrollEmployees } from "@/lib/entityAdapters/payrollEmployee";

type MandateResult = { umrn?: string; status?: string; message?: string } & Record<string, unknown>;

const FREQUENCIES = ["monthly", "quarterly", "yearly", "one-time"] as const;

export function NachMandateForm() {
  const t = useTranslations("nachMandateForm");
  // GAP-PAYROLL-DISBURSEMENT-08: picked from the employee directory (the
  // backend requires an employee UUID) instead of a free-text UUID box.
  const [employeeRef, setEmployeeRef] = useState<string | null>(null);
  const employeeLabels = useRef(new Map<string, string>());
  const [amountRupees, setAmountRupees] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("monthly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [accountType, setAccountType] = useState<"savings" | "current">("savings");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [startInvalid, setStartInvalid] = useState(false);
  const [endInvalid, setEndInvalid] = useState(false);

  const [statusRef, setStatusRef] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<MandateResult | null>(null);
  const [statusRefInvalid, setStatusRefInvalid] = useState(false);
  const formError = useFormError("mandate");

  const empIdField = useId();
  const amtField = useId();
  const freqField = useId();
  const startField = useId();
  const endField = useId();
  const acctField = useId();
  const errId = useId();
  const refField = useId();
  const statusErrId = useId();

  const amountFieldRef = useRef<HTMLInputElement>(null);
  const startFieldRef = useRef<HTMLInputElement>(null);
  const endFieldRef = useRef<HTMLInputElement>(null);
  const statusRefFieldRef = useRef<HTMLInputElement>(null);

  // UX-017: option display text for FREQUENCIES kept as a lookup by value
  // (not a plain array.map over FREQUENCIES) so each raw value can carry its
  // own translated label without changing behaviour.
  const FREQUENCY_LABELS: Record<(typeof FREQUENCIES)[number], string> = {
    monthly: t("frequencyMonthly"),
    quarterly: t("frequencyQuarterly"),
    yearly: t("frequencyYearly"),
    "one-time": t("frequencyOneTime"),
  };

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const empMissing = !employeeRef;
    const amtMissing = !amountRupees.trim();
    // Validate the amount as an exact paise value up front (no float maths):
    // "1234.56" -> 123456; "1.005", "-5", "0", "abc" are rejected.
    const amtBad = !amtMissing && rupeesToMinorString(amountRupees) === null;
    const startMissing = !startDate;
    const endMissing = !endDate;
    setAmountInvalid(amtMissing || amtBad);
    setStartInvalid(startMissing);
    setEndInvalid(endMissing);
    if (empMissing || amtMissing || startMissing || endMissing) {
      setError(t("requiredFieldsError"));
      if (empMissing) {
        document.getElementById(empIdField)?.focus();
      } else if (amtMissing) {
        amountFieldRef.current?.focus();
      } else if (startMissing) {
        startFieldRef.current?.focus();
      } else {
        endFieldRef.current?.focus();
      }
      return;
    }
    if (amtBad) {
      setError(t("amountInvalidError"));
      amountFieldRef.current?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function searchAndRemember(query: string, signal: AbortSignal): Promise<EntityOption[]> {
    const options = await searchPayrollEmployees(query, signal);
    for (const o of options) employeeLabels.current.set(o.id, o.label);
    return options;
  }

  async function submitMandate() {
    setBusy(true);
    setError(undefined);
    try {
      const amountMinor = rupeesToMinorString(amountRupees);
      if (!amountMinor || !employeeRef) {
        setError(t("amountInvalidError"));
        return;
      }
      const res = await browserJson<{ data: MandateResult }>("v1/payroll/nach/mandates", {
        method: "POST",
        body: JSON.stringify({
          employeeRef,
          // bigint-safe paise as a decimal string; the API coerces to bigint.
          amountMinor,
          frequency,
          startDate,
          endDate,
          accountType,
        }),
      });
      setConfirmOpen(false);
      setMessage(
        t("mandateSubmittedMessage", {
          umrn: res.data.umrn ?? t("umrnPending"),
          status: res.data.status ?? t("statusSubmitted"),
        }),
      );
      setEmployeeRef(null);
      setAmountRupees("");
      setStartDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus(e: React.FormEvent) {
    e.preventDefault();
    setStatusError(null);
    setStatusResult(null);
    if (!statusRef.trim()) {
      setStatusRefInvalid(true);
      setStatusError(t("statusRefRequiredError"));
      statusRefFieldRef.current?.focus();
      return;
    }
    setStatusRefInvalid(false);
    setStatusBusy(true);
    try {
      const res = await browserFetch(`v1/payroll/nach/mandates/${encodeURIComponent(statusRef.trim())}/status`, {
        method: "GET",
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "unknownStatus");
        setStatusError(resolved.message);
        return;
      }
      const body = (await res.json()) as { data: MandateResult };
      setStatusResult(body.data);
    } catch {
      setStatusError(formError.fromException("unknownStatus").message);
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={openConfirm}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("employeeRefLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <EntityPicker
              id={empIdField}
              value={employeeRef}
              onChange={(v) => {
                setEmployeeRef(Array.isArray(v) ? v[0] ?? null : v);
              }}
              search={searchAndRemember}
              resolve={resolvePayrollEmployees}
              placeholder={t("employeePlaceholder")}
              noResultsText={t("employeeNoResults")}
              searchingText={t("employeeSearching")}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={amtField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("amountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={amtField}
              ref={amountFieldRef}
              type="number"
              min="0"
              step="0.01"
              value={amountRupees}
              onChange={(e) => {
                setAmountRupees(e.target.value);
                setAmountInvalid(false);
              }}
              aria-required="true"
              aria-invalid={amountInvalid || undefined}
              aria-describedby={amountInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={freqField} style={{ fontSize: 13, fontWeight: 600 }}>{t("frequencyLabel")}</label>
            <select
              id={freqField}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as (typeof FREQUENCIES)[number])}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={acctField} style={{ fontSize: 13, fontWeight: 600 }}>{t("accountTypeLabel")}</label>
            <select
              id={acctField}
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as "savings" | "current")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              <option value="savings">{t("savingsOption")}</option>
              <option value="current">{t("currentOption")}</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={startField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("startDateLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={startField}
              ref={startFieldRef}
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setStartInvalid(false);
              }}
              aria-required="true"
              aria-invalid={startInvalid || undefined}
              aria-describedby={startInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={endField} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("endDateLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={endField}
              ref={endFieldRef}
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setEndInvalid(false);
              }}
              aria-required="true"
              aria-invalid={endInvalid || undefined}
              aria-describedby={endInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>
            {t("submitBtn")}
          </Button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            {message}
          </p>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title={t("submitConfirmTitle")}
          danger
          confirmLabel={t("submitConfirmLabel")}
          busy={busy}
          errorMessage={error}
          description={t.rich("submitConfirmDescription", {
            frequency,
            amount: formatMoney(rupeesToMinorString(amountRupees)),
            employeeId: (employeeRef && employeeLabels.current.get(employeeRef)) ?? employeeRef ?? "",
            start: startDate,
            end: endDate,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
          onConfirm={() => void submitMandate()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />
      </form>

      <form onSubmit={checkStatus} style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 200 }}>
            <label htmlFor={refField} style={{ fontSize: 13, fontWeight: 600 }}>{t("checkMandateStatusLabel")}</label>
            <input
              id={refField}
              ref={statusRefFieldRef}
              value={statusRef}
              onChange={(e) => {
                setStatusRef(e.target.value);
                setStatusRefInvalid(false);
              }}
              aria-invalid={statusRefInvalid || undefined}
              aria-describedby={statusRefInvalid ? statusErrId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <Button type="submit" variant="secondary" style={{ minHeight: 44 }} disabled={statusBusy}>
            {t("checkStatusBtn")}
          </Button>
        </div>
        {statusError && (
          <p id={statusErrId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {statusError}
          </p>
        )}
        {statusResult && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            {t("statusResultLabel", { status: statusResult.status ?? t("statusUnknownFallback") })}
          </p>
        )}
      </form>
    </div>
  );
}
