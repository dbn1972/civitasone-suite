"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { browserFetch } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

// GAP-BILLING-PLANS-NEW-06: canonical plan code is lowercase snake/kebab.
const CODE_RE = /^[a-z0-9_-]{2,64}$/;

// GAP-BILLING-PLANS-NEW-03/04 DECISION: this is a Government-edition product;
// the billing-service create schema accepts any 3-letter currency, but every
// amount in the app is formatted in ₹ and operations are rupee-denominated.
// Restrict the picker to INR so a plan can't be created in a currency the rest
// of the system won't display correctly. (If multi-currency is ever enabled per
// tenant, widen this from tenant settings.)
const CURRENCIES = ["INR"] as const;

// GAP-BILLING-PLANS-NEW-01: the billing-service POST /v1/billing/plans body
// (plans/validators.ts createPlanBody) is { name, code, priceMinor, currency,
// govtExempt } — there is NO `interval` field, and no column stores one. The
// old form rendered a Billing Interval select whose value was silently
// discarded on submit. A dead control that looks required is removed rather
// than left to mislead; reinstate it only once the backend persists an
// interval.

type FieldKey = "name" | "code" | "amount";

export function NewPlanForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [currency] = useState<(typeof CURRENCIES)[number]>("INR");
  // GAP-BILLING-PLANS-NEW-04: default OFF — tax exemption is a consequential,
  // deliberate choice, not a silent default.
  const [govtExempt, setGovtExempt] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formError = useFormError("plan");

  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const nameId = useId();
  const codeId = useId();
  const amountId = useId();
  const currencyId = useId();
  const govtExemptId = useId();
  const govtExemptHelpId = useId();
  const codeHelpId = useId();
  const amountHelpId = useId();
  const statusMsgId = useId();
  const nameErrId = useId();
  const codeErrId = useId();
  const amountErrId = useId();

  const refs: Record<FieldKey, React.RefObject<HTMLInputElement>> = { name: nameRef, code: codeRef, amount: amountRef };

  const priceMinor = rupeesToMinorString(amount);
  const pricePreview = priceMinor !== null ? formatMoney(priceMinor) : null;

  function validate(): { ok: true; priceMinor: string; code: string } | { ok: false; first: FieldKey } {
    const next: Partial<Record<FieldKey, string>> = {};
    if (name.trim().length < 2) next.name = "Plan name must be at least 2 characters.";
    const trimmedCode = code.trim().toLowerCase();
    if (!CODE_RE.test(trimmedCode)) {
      next.code = "Lowercase letters, digits, - and _ only (2–64 characters).";
    }
    const pm = rupeesToMinorString(amount);
    if (pm === null) next.amount = "Amount must be a positive number with at most 2 decimals.";
    setFieldErrors(next);
    const order: FieldKey[] = ["name", "code", "amount"];
    const first = order.find((k) => next[k]);
    if (first) return { ok: false, first };
    return { ok: true, priceMinor: pm as string, code: trimmedCode };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate();
    if (!result.ok) {
      setStatus("error");
      setMessage("Please fix the highlighted fields.");
      // GAP-BILLING-PLANS-NEW-02: move focus to the first invalid field.
      refs[result.first].current?.focus();
      return;
    }
    setStatus("idle");
    setMessage("");
    // GAP-BILLING-PLANS-NEW-03: confirm the priced plan before POST.
    setConfirmOpen(true);
  }

  async function doCreate() {
    const result = validate();
    if (!result.ok) {
      setConfirmOpen(false);
      setStatus("error");
      refs[result.first].current?.focus();
      return;
    }
    setConfirmOpen(false);
    setStatus("submitting");
    setMessage("");
    setFieldErrors({});
    try {
      // GAP-BILLING-PLANS-NEW-05: browserFetch adds x-device-id / device-trust
      // headers the raw fetch() omitted. priceMinor is a decimal paise STRING
      // (string-parsed, no float math — GAP-BILLING-PLANS-NEW-03).
      // priceMinor: the billing-service createPlanBody validates
      // z.number().int(), so the WIRE type must be a number. We still compute it
      // with no float math — rupeesToMinorString parses the rupees string into
      // an exact integer-paise STRING, and Number() of that integer string is
      // exact for any realistic amount (<2^53 paise ≈ ₹9×10^13). This avoids
      // the old Math.round(parseFloat(amount)*100) mis-rounding of e.g. 1.005.
      const res = await browserFetch("v1/billing/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: result.code,
          priceMinor: Number(result.priceMinor),
          currency,
          govtExempt,
        }),
      });
      if (!res.ok) {
        const next = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(next.message);
        // GAP-BILLING-PLANS-NEW-02/06: land server field errors on the field.
        const serverFields: Partial<Record<FieldKey, string>> = {};
        (["name", "code", "amount"] as FieldKey[]).forEach((k) => {
          const key = k === "amount" ? "priceMinor" : k;
          if (next.fieldErrors[key]) serverFields[k] = next.fieldErrors[key];
        });
        if (Object.keys(serverFields).length) {
          setFieldErrors(serverFields);
          const firstK = (["name", "code", "amount"] as FieldKey[]).find((k) => serverFields[k]);
          if (firstK) refs[firstK].current?.focus();
        }
        return;
      }
      setStatus("success");
      setMessage("Plan created successfully.");
      router.push("/billing/plans");
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 10, border: "1px solid var(--line)", padding: "10px 12px",
    fontSize: 13, minHeight: 44, background: "var(--panel)", color: "var(--ink)", outline: "none",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 };
  const errStyle: React.CSSProperties = { marginTop: 4, fontSize: 12, color: "var(--bad, #b42318)" };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24, maxWidth: 672, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r)", boxShadow: "var(--sh-md)" }}
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      <div>
        <label htmlFor={nameId} style={labelStyle}>Plan Name</label>
        <input
          id={nameId} ref={nameRef} type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard Monthly" style={inputStyle}
          required aria-required="true"
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? nameErrId : undefined}
          autoComplete="off"
        />
        {fieldErrors.name && <p id={nameErrId} style={errStyle} role="alert">⚠ {fieldErrors.name}</p>}
      </div>

      <div>
        <label htmlFor={codeId} style={labelStyle}>Plan Code</label>
        <input
          id={codeId} ref={codeRef} type="text" value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => setCode((c) => c.trim().toLowerCase())}
          placeholder="e.g. standard_monthly" style={inputStyle}
          required aria-required="true"
          aria-invalid={!!fieldErrors.code}
          aria-describedby={fieldErrors.code ? `${codeErrId} ${codeHelpId}` : codeHelpId}
          minLength={2} maxLength={64} pattern="[a-z0-9_\-]+" inputMode="text" autoComplete="off"
        />
        <p id={codeHelpId} style={{ marginTop: 4, fontSize: 12, color: "var(--ink2)" }}>
          Lowercase letters, digits, - and _ only. Must be unique.
        </p>
        {fieldErrors.code && <p id={codeErrId} style={errStyle} role="alert">⚠ {fieldErrors.code}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={amountId} style={labelStyle}>Amount (₹)</label>
          <input
            id={amountId} ref={amountRef} type="text" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00" style={inputStyle}
            required aria-required="true"
            aria-invalid={!!fieldErrors.amount}
            aria-describedby={fieldErrors.amount ? `${amountErrId} ${amountHelpId}` : amountHelpId}
          />
          <p id={amountHelpId} style={{ marginTop: 4, fontSize: 12, color: "var(--ink2)" }}>
            {pricePreview ? `Will be billed as ${pricePreview}` : "Rupees, up to 2 decimals."}
          </p>
          {fieldErrors.amount && <p id={amountErrId} style={errStyle} role="alert">⚠ {fieldErrors.amount}</p>}
        </div>

        <div>
          <label htmlFor={currencyId} style={labelStyle}>Currency</label>
          <select id={currencyId} value={currency} disabled style={inputStyle} aria-readonly="true">
            {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <input
          id={govtExemptId} type="checkbox" checked={govtExempt}
          onChange={(e) => setGovtExempt(e.target.checked)}
          className="h-4 w-4 rounded"
          aria-describedby={govtExemptHelpId}
          style={{ marginTop: 3 }}
        />
        <div>
          <label htmlFor={govtExemptId} style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)" }}>
            Government exempt
          </label>
          <p id={govtExemptHelpId} style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
            Marks the plan as exempt from GST on invoices generated for it. Leave
            unchecked unless this plan is billed to a GST-exempt government body.
          </p>
        </div>
      </div>

      <Button type="submit" disabled={status === "submitting"} variant="primary" style={{ minHeight: 44 }}>
        {status === "submitting" ? "Creating…" : "Create Plan"}
      </Button>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          <span className="font-semibold">{status === "error" ? "Error: " : "Success: "}</span>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Create this billing plan?"
        description={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            <li>Name: {name.trim() || "—"}</li>
            <li>Code: {code.trim().toLowerCase() || "—"}</li>
            <li>Price: {pricePreview ?? "—"}</li>
            <li>Government exempt: {govtExempt ? "Yes" : "No"}</li>
          </ul>
        }
        confirmLabel="Confirm & create"
        busy={status === "submitting"}
        onConfirm={doCreate}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  );
}
