"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { Button, Field, Input, Select } from "../../../_components/ds";

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
    const amountMinor = rupeesToMinorString(amount);
    if (amountMinor === null || !Number.isSafeInteger(Number(amountMinor))) errs.add("amount");
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
        amountMinor: Number(rupeesToMinorString(amount)),
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
    } catch (caught) {
      setMessage({ tone: "bad", text: formError.fromException("save", caught).message });
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
            <Field
              label={t("formLabelEmployee")}
              required
              error={
                employeeFetchError === "forbidden" ? t("formEmployeeListForbidden")
                : employeeFetchError === "other" ? t("formEmployeeListError")
                : invalid.has("employee") ? t("formEmployeeRequired")
                : undefined
              }
            >
              <Select value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); clearErr("employee"); }}
                disabled={employeeFetchError !== "none"}>
                <option value="">{t("formSelectEmployee")}</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
                ))}
              </Select>
            </Field>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <Field label={t("formLabelAmount")} required
              error={invalid.has("amount") ? t("formAmountInvalid") : formError.fieldError("amountMinor")}>
              <Input type="number" min={1} step={1} value={amount}
                onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                placeholder={t("formPlaceholderAmount")} />
            </Field>
            <div>
              <Field label={t("formLabelMonths")} required error={invalid.has("months") ? t("formMonthsInvalid") : undefined}>
                <Input type="number" min={1} max={12} step={1} value={months}
                  onChange={(e) => { setMonths(e.target.value); clearErr("months"); }} />
              </Field>
              {!invalid.has("months") && (
                <p style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>{t("formMonthsHint")}</p>
              )}
            </div>
            <Field label={t("formLabelDate")}>
              <Input type="date" value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)} />
            </Field>
          </div>

          <Field label={t("formLabelPurpose")} required
            error={invalid.has("purpose") ? t("formPurposeInvalid") : formError.fieldError("purpose")}>
            <Input type="text" minLength={2} maxLength={200} value={purpose}
              onChange={(e) => { setPurpose(e.target.value); clearErr("purpose"); }}
              placeholder={t("formPlaceholderPurpose")} />
          </Field>

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
