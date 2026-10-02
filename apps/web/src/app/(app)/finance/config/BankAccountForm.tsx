"use client";

/**
 * GAP-FINANCE-CONFIG-01: add an office bank account from the UI (previously
 * the page told the accountant to call POST /v1/finance/bank-accounts).
 * Client validation mirrors finance-service's createBankBody (bank-routes.ts):
 * the server re-validates and is the real control. The full account number is
 * sent once on create; the list only ever shows the server-masked last 4.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button, Card } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2, "Enter the bank's name.").max(200),
  branchName: z.string().trim().max(200).optional(),
  accountNo: z.string().trim().regex(/^\d{5,30}$/, "Account number must be 5–30 digits."),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like SBIN0001234."),
  accountType: z.enum(["savings", "current", "overdraft"]),
  purpose: z.string().trim().max(64).optional(),
});

type Field = "bankName" | "branchName" | "accountNo" | "ifsc" | "accountType" | "purpose";
const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

export function BankAccountForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
    bankName: "", branchName: "", accountNo: "", ifsc: "", accountType: "current", purpose: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const base = useId();

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitError(null);
    const parsed = bankAccountSchema.safeParse({
      ...values,
      branchName: values.branchName.trim() || undefined,
      purpose: values.purpose.trim() || undefined,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as Field;
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await browserJson("v1/finance/bank-accounts", { method: "POST", body: JSON.stringify(parsed.data) });
      setMessage(`Bank account ending ${parsed.data.accountNo.slice(-4)} submitted. It will appear in the list shortly.`);
      setValues({ bankName: "", branchName: "", accountNo: "", ifsc: "", accountType: "current", purpose: "" });
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: Field, label: string, input: React.ReactNode) => (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={`${base}-${k}`} style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
      {input}
      {errors[k] && <p id={`${base}-${k}-err`} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors[k]}</p>}
    </div>
  );
  const common = (k: Field) => ({
    id: `${base}-${k}`,
    value: values[k],
    onChange: set(k),
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${base}-${k}-err` : undefined,
    style: inputStyle,
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card title="Add Bank Account" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            {field("bankName", "Bank name", <input {...common("bankName")} maxLength={200} />)}
            {field("branchName", "Branch (optional)", <input {...common("branchName")} maxLength={200} />)}
            {field("accountNo", "Account number", <input {...common("accountNo")} inputMode="numeric" autoComplete="off" maxLength={30} />)}
            {field("ifsc", "IFSC", <input {...common("ifsc")} autoComplete="off" maxLength={11} style={{ ...inputStyle, textTransform: "uppercase" }} />)}
            {field("accountType", "Account type", (
              <select {...common("accountType")}>
                <option value="current">Current</option>
                <option value="savings">Savings</option>
                <option value="overdraft">Overdraft</option>
              </select>
            ))}
            {field("purpose", "Purpose (optional)", <input {...common("purpose")} maxLength={64} placeholder="e.g. Salary, Scheme" />)}
          </div>
          <div>
            <Button type="submit" disabled={busy} aria-busy={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Add bank account"}
            </Button>
          </div>
          {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
          {submitError && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13, margin: 0 }}>{submitError}</p>}
        </div>
      </Card>
    </form>
  );
}
