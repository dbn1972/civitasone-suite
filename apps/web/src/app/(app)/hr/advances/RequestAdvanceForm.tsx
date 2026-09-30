"use client";

import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../_components/ds";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

type EmployeeOption = { id: string; name: string; employeeNo: string };

/**
 * GAP-HR-ADVANCES-03: `selfServiceOnly` is true for a session holding only
 * the "employee" role (no HR/manager/officer overlap) -- the backend forces
 * their own employeeId server-side regardless of what this form sends, so
 * the picker is hidden entirely rather than shown and ignored. The employee
 * directory fetch is skipped too: a self-filer has nothing to pick.
 */
export function RequestAdvanceForm({ selfServiceOnly = false }: { selfServiceOnly?: boolean }) {
  const t = useTranslations("advances");
  const ids = {
    employee: useId(), amount: useId(), purpose: useId(),
    months: useId(), date: useId(),
  };
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeFetchError, setEmployeeFetchError] = useState<"none" | "forbidden" | "other">("none");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [months, setMonths] = useState("3");
  const [requestDate, setRequestDate] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const formError = useFormError("advance request");

  useEffect(() => {
    if (selfServiceOnly) return;
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/employees?limit=500", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) {
          // GAP-HR-ADVANCES-05: a 403 here (officer/finance_admin, denied by
          // DIRECTORY_ROLES) is a permission boundary, not a transient
          // failure -- distinguish it so the message doesn't tell someone
          // to "refresh and try again" for something retrying can't fix.
          throw new Error(r.status === 403 ? "forbidden" : String(r.status));
        }
        return r.json();
      })
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setEmployeeFetchError(err instanceof Error && err.message === "forbidden" ? "forbidden" : "other");
      });
    return () => controller.abort();
  }, [selfServiceOnly]);

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!selfServiceOnly && !employeeId) errs.add("employee");
    const amtVal = Number(amount);
    if (!amount || isNaN(amtVal) || amtVal <= 0) errs.add("amount");
    if (!purpose.trim() || purpose.trim().length < 2) errs.add("purpose");
    const mo = parseInt(months, 10);
    if (!months || isNaN(mo) || mo < 1 || mo > 12) errs.add("months");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    formError.clear();
    try {
      const body: Record<string, unknown> = {
        amountMinor: Math.round(Number(amount) * 100),
        purpose: purpose.trim(),
        recoveryMonths: parseInt(months, 10),
      };
      if (!selfServiceOnly) body.employeeId = employeeId;
      if (requestDate) body.requestDate = requestDate;
      const res = await fetch("/api/proxy/v1/hrms/salary-advances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "bad", text: resolved.message });
        return;
      }
      setMessage({ tone: "good", text: t("formSuccessMessage") });
      setAmount(""); setPurpose(""); setMonths("3"); setRequestDate("");
      setOpen(false);
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>{t("formHeading")}</h3>
        <Button
          variant="primary"
          size="sm"
          style={{ minHeight: 36 }}
          onClick={() => { setOpen((o) => !o); setMessage(null); }}
          aria-expanded={open}
        >
          {open ? t("formCancel") : t("formNewRequest")}
        </Button>
      </div>

      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 8px" }}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>
          {!selfServiceOnly && (
            <div>
              <label htmlFor={ids.employee} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelEmployee")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <select id={ids.employee} value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); clearErr("employee"); }}
                disabled={employeeFetchError !== "none"}
                style={invalid.has("employee") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("employee")}>
                <option value="">{t("formSelectEmployee")}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
                ))}
              </select>
              {employeeFetchError === "forbidden" && <p role="alert" style={fieldErrStyle}>{t("formEmployeeListForbidden")}</p>}
              {employeeFetchError === "other" && <p role="alert" style={fieldErrStyle}>{t("formEmployeeListError")}</p>}
              {employeeFetchError === "none" && invalid.has("employee") && <p role="alert" style={fieldErrStyle}>{t("formEmployeeRequired")}</p>}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.amount} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelAmount")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.amount} type="number" min={1} step={1} value={amount}
                onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                placeholder={t("formPlaceholderAmount")}
                style={invalid.has("amount") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("amount")} />
              {invalid.has("amount") && <p role="alert" style={fieldErrStyle}>{t("formAmountInvalid")}</p>}
              {!invalid.has("amount") && formError.fieldError("amountMinor") && (
                <p role="alert" style={fieldErrStyle}>{formError.fieldError("amountMinor")}</p>
              )}
            </div>
            <div>
              <label htmlFor={ids.months} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelMonths")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.months} type="number" min={1} max={12} step={1} value={months}
                onChange={(e) => { setMonths(e.target.value); clearErr("months"); }}
                style={invalid.has("months") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("months")} />
              {invalid.has("months") ? (
                <p role="alert" style={fieldErrStyle}>{t("formMonthsInvalid")}</p>
              ) : (
                <p style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>{t("formMonthsHint")}</p>
              )}
            </div>
            <div>
              <label htmlFor={ids.date} style={{ fontSize: 13, fontWeight: 500 }}>{t("formLabelDate")}</label>
              <input id={ids.date} type="date" value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                style={inputStyle} />
            </div>
          </div>

          <div>
            <label htmlFor={ids.purpose} style={{ fontSize: 13, fontWeight: 500 }}>
              {t("formLabelPurpose")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
            </label>
            <input id={ids.purpose} type="text" minLength={2} maxLength={200} value={purpose}
              onChange={(e) => { setPurpose(e.target.value); clearErr("purpose"); }}
              placeholder={t("formPlaceholderPurpose")}
              style={invalid.has("purpose") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("purpose")}
              aria-describedby={invalid.has("purpose") ? `${ids.purpose}-err` : undefined} />
            {invalid.has("purpose") && <p id={`${ids.purpose}-err`} role="alert" style={fieldErrStyle}>{t("formPurposeInvalid")}</p>}
            {!invalid.has("purpose") && formError.fieldError("purpose") && (
              <p role="alert" style={fieldErrStyle}>{formError.fieldError("purpose")}</p>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" variant="primary" disabled={busy || employeeFetchError !== "none"} style={{ minHeight: 44, minWidth: 160 }}>
              {busy ? t("formSubmitting") : t("formSubmit")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
