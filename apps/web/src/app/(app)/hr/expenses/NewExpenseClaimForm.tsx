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
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus } from "@/lib/formatters";
import { Button, Field, Input, Select } from "../../../_components/ds";
import { parseRupeesToPaise } from "./parseRupeesToPaise";

// Matches expenseClaimSchema's category enum exactly (services/hrms-service/
// src/modules/social/routes.ts) -- humanizeStatus gives the same label the
// read-side table column already shows for each value (mapExpenses.ts), so
// the option text and the eventual table row read the same way.
const CATEGORIES = ["travel", "food", "accommodation", "transport", "medical", "stationery", "communication", "other"] as const;

/**
 * GAP-HR-TRAVEL-02: `travelRequestId` (from /hr/expenses?travelRequestId=...,
 * validated by travelLink.ts) pre-links the claim to an approved travel
 * request: the form opens straight away, says so, and sends the id in the
 * POST body. The route re-checks ownership server-side.
 */
export function NewExpenseClaimForm({ travelRequestId }: { travelRequestId?: string } = {}) {
  const t = useTranslations("expenses");
  const [open, setOpen] = useState(Boolean(travelRequestId));
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
          ...(travelRequestId ? { travelRequestId } : {}),
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
          {travelRequestId && (
            <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("formLinkedTravel")}</p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label={t("formLabelCategory")} required>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{humanizeStatus(c)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("formLabelAmount")} required
              error={invalid.has("amount") ? t("formAmountInvalid") : formError.fieldError("amount")}>
              <Input type="text" inputMode="decimal" value={amount}
                onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                placeholder={t("formPlaceholderAmount")} />
            </Field>
            <Field label={t("formLabelDate")} required error={invalid.has("date") ? t("formDateRequired") : undefined}>
              <Input type="date" value={date}
                onChange={(e) => { setDate(e.target.value); clearErr("date"); }} />
            </Field>
          </div>

          <Field label={t("formLabelDescription")} error={formError.fieldError("description")}>
            <Input type="text" maxLength={500} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("formPlaceholderDescription")} />
          </Field>

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
