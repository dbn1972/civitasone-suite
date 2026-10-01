"use client";

/**
 * GAP-HR-EXPENSES-02: the page's own subtitle promised an approval workflow,
 * but there was no way to submit a claim from the UI at all -- the backend's
 * POST /v1/hrms/expenses existed with no caller. Mirrors hr/advances'
 * RequestAdvanceForm.tsx (same card-with-toggle layout, same
 * useFormError-driven error handling, same /api/proxy/v1/hrms/... POST
 * convention), with one deliberate difference: amount is converted via
 * parseRupeesToPaise.ts (a proper string parser), not
 * `Math.round(Number(rupees) * 100)` -- see that module's own doc comment
 * for why.
 */
import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus } from "@/lib/formatters";
import { Button } from "../../../_components/ds";
import { parseRupeesToPaise } from "./parseRupeesToPaise";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

// Matches expenseClaimSchema's category enum exactly (services/hrms-service/
// src/modules/social/routes.ts) -- humanizeStatus gives the same label the
// read-side table column already shows for each value (mapExpenses.ts), so
// the option text and the eventual table row read the same way.
const CATEGORIES = ["travel", "food", "accommodation", "transport", "medical", "stationery", "communication", "other"] as const;

export function NewExpenseClaimForm() {
  const t = useTranslations("expenses");
  const ids = { category: useId(), amount: useId(), description: useId(), date: useId() };
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("travel");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const formError = useFormError("expense claim");

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): { amountMinor: number } | null {
    const errs = new Set<string>();
    const amountMinor = parseRupeesToPaise(amount);
    if (amountMinor === null || amountMinor <= 0) errs.add("amount");
    if (!date) errs.add("date");
    setInvalid(errs);
    return errs.size === 0 && amountMinor !== null ? { amountMinor } : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = validate();
    if (!parsed) return;
    setBusy(true);
    setMessage(null);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          amount: parsed.amountMinor,
          description: description.trim() || undefined,
          date,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "bad", text: resolved.message });
        return;
      }
      setMessage({ tone: "good", text: t("formSuccessMessage") });
      setAmount(""); setDescription(""); setDate("");
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
          {open ? t("formCancel") : t("formNewClaim")}
        </Button>
      </div>

      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 8px" }}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.category} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelCategory")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <select id={ids.category} value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{humanizeStatus(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.amount} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelAmount")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.amount} type="text" inputMode="decimal" value={amount}
                onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                placeholder={t("formPlaceholderAmount")}
                style={invalid.has("amount") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("amount")} />
              {invalid.has("amount") && <p role="alert" style={fieldErrStyle}>{t("formAmountInvalid")}</p>}
              {!invalid.has("amount") && formError.fieldError("amount") && (
                <p role="alert" style={fieldErrStyle}>{formError.fieldError("amount")}</p>
              )}
            </div>
            <div>
              <label htmlFor={ids.date} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("formLabelDate")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.date} type="date" value={date}
                onChange={(e) => { setDate(e.target.value); clearErr("date"); }}
                style={invalid.has("date") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("date")} />
              {invalid.has("date") && <p role="alert" style={fieldErrStyle}>{t("formDateRequired")}</p>}
            </div>
          </div>

          <div>
            <label htmlFor={ids.description} style={{ fontSize: 13, fontWeight: 500 }}>{t("formLabelDescription")}</label>
            <input id={ids.description} type="text" maxLength={500} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("formPlaceholderDescription")}
              style={inputStyle} />
            {formError.fieldError("description") && (
              <p role="alert" style={fieldErrStyle}>{formError.fieldError("description")}</p>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44, minWidth: 160 }}>
              {busy ? t("formSubmitting") : t("formSubmit")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
