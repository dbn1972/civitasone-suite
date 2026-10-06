"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { Button, Field, Select, Input, Textarea } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type AmendLine = {
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number; // paise
  totalPrice: number; // paise
};

const AMENDMENT_TYPES = ["quantity", "price", "schedule", "scope", "change_order"] as const;
type AmendmentType = (typeof AMENDMENT_TYPES)[number];

const TYPE_LABEL: Record<AmendmentType, string> = {
  quantity: "Quantity change",
  price: "Price change",
  schedule: "Schedule change",
  scope: "Scope change",
  change_order: "Change order (value)",
};

// A signed rupees string ("-500.50") to paise, exact (no float). Returns null
// on anything invalid. A leading "-" denotes a reduction.
function signedRupeesToMinor(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const neg = t.startsWith("-");
  const mag = rupeesToMinorString(neg ? t.slice(1) : t, { allowZero: true });
  if (mag === null) return null;
  const n = Number(mag);
  return neg ? -n : n;
}

export function AmendForm({
  poId,
  currentTotalMinor,
  lineItems,
}: {
  poId: string;
  currentTotalMinor: number;
  lineItems: AmendLine[];
}) {
  const router = useRouter();
  const [amendmentType, setAmendmentType] = useState<AmendmentType>("scope");
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  // change_order / scope: a signed rupee delta string.
  const [deltaRupees, setDeltaRupees] = useState("");
  // quantity / price: a chosen line + a new value.
  const [lineIdx, setLineIdx] = useState(0);
  const [newQty, setNewQty] = useState("");
  const [newUnitPriceRupees, setNewUnitPriceRupees] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("PO amendment");
  const [fieldError, setFieldError] = useState("");

  const selectedLine = lineItems[lineIdx];

  // Compute the signed delta (paise) implied by the current inputs, per type.
  const { deltaMinor, deltaError } = useMemo((): { deltaMinor: number | null; deltaError: string } => {
    if (amendmentType === "schedule") return { deltaMinor: 0, deltaError: "" };
    if (amendmentType === "scope") {
      // Scope: value may or may not change; default 0 when left blank.
      if (deltaRupees.trim() === "") return { deltaMinor: 0, deltaError: "" };
      const d = signedRupeesToMinor(deltaRupees);
      return d === null ? { deltaMinor: null, deltaError: "Enter a valid rupee amount (e.g. 5000 or -5000)." } : { deltaMinor: d, deltaError: "" };
    }
    if (amendmentType === "change_order") {
      const d = signedRupeesToMinor(deltaRupees);
      if (d === null) return { deltaMinor: null, deltaError: "Enter a valid rupee amount (e.g. 5000 or -5000)." };
      if (d === 0) return { deltaMinor: null, deltaError: "A change order must change the PO value (non-zero)." };
      return { deltaMinor: d, deltaError: "" };
    }
    if (!selectedLine) return { deltaMinor: null, deltaError: "Choose a line item." };
    if (amendmentType === "quantity") {
      if (newQty.trim() === "" || !/^\d+$/.test(newQty.trim())) return { deltaMinor: null, deltaError: "Enter the new quantity (whole number)." };
      const q = Number(newQty);
      if (q === selectedLine.quantity) return { deltaMinor: null, deltaError: "The new quantity must differ from the current one." };
      return { deltaMinor: (q - selectedLine.quantity) * selectedLine.unitPrice, deltaError: "" };
    }
    // price
    const newUnitMinorStr = rupeesToMinorString(newUnitPriceRupees, { allowZero: true });
    if (newUnitMinorStr === null) return { deltaMinor: null, deltaError: "Enter the new unit price in rupees." };
    const newUnitMinor = Number(newUnitMinorStr);
    if (newUnitMinor === selectedLine.unitPrice) return { deltaMinor: null, deltaError: "The new unit price must differ from the current one." };
    return { deltaMinor: (newUnitMinor - selectedLine.unitPrice) * selectedLine.quantity, deltaError: "" };
  }, [amendmentType, deltaRupees, selectedLine, newQty, newUnitPriceRupees]);

  const revisedTotal = deltaMinor === null ? null : currentTotalMinor + deltaMinor;
  // Cap: a negative delta cannot take the PO below zero.
  const belowZero = revisedTotal !== null && revisedTotal < 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError("");
    if (reason.trim().length < 3) {
      setStatus("error");
      setMessage("Reason must be at least 3 characters.");
      return;
    }
    if (deltaError) { setFieldError(deltaError); return; }
    if (belowZero) { setFieldError("The revised total cannot be negative — reduce the amount."); return; }
    if (amendmentType === "schedule" && !effectiveDate) { setFieldError("Choose the new delivery/effective date."); return; }

    // Build a reason that records the structured change (the backend amendment
    // contract carries amendmentType + reason + deltaMinor + effectiveDate; see
    // amendment-validators.ts — DECISION: compute the delta client-side and put
    // the structured detail in the reason rather than inventing a line-level
    // field the API does not accept).
    let structuredReason = reason.trim();
    if (amendmentType === "quantity" && selectedLine) {
      structuredReason = `[Line ${selectedLine.itemCode}] qty ${selectedLine.quantity} → ${newQty}. ${structuredReason}`;
    } else if (amendmentType === "price" && selectedLine) {
      structuredReason = `[Line ${selectedLine.itemCode}] unit price ${formatMoney(selectedLine.unitPrice)} → ${formatMoney(Number(rupeesToMinorString(newUnitPriceRupees, { allowZero: true })))}. ${structuredReason}`;
    }

    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${poId}/amendments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amendmentType,
          reason: structuredReason,
          deltaMinor: deltaMinor ?? 0,
          effectiveDate: effectiveDate || undefined,
        }),
      });
      if (!res.ok) {
        const human = toHumanError("save", { area: "PO amendment" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      setStatus("accepted");
      setMessage("Amendment submitted for approval.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(formError.fromException("save", err).message);
    }
  }

  // GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-05: after success, show a persistent
  // panel with a link back (no fixed-timeout redirect that a screen-reader user
  // could miss).
  if (status === "accepted") {
    return (
      <div className="card pad" role="status" aria-live="polite" style={{ display: "grid", gap: 12 }}>
        <p style={{ color: "var(--good)", margin: 0 }}>Amendment submitted for approval.</p>
        <p style={{ color: "#64748b", margin: 0, fontSize: "0.875rem" }}>
          It will be reviewed by an approver (a different officer). You can track it from the purchase order.
        </p>
        <div>
          <Link href={`/procurement/orders/${poId}`} className="btn primary" style={{ minHeight: 44 }}>
            Back to purchase order
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" noValidate>
      <div className="fields">
        <Field label="Amendment type *">
          <Select
            value={amendmentType}
            onChange={(e) => { setAmendmentType(e.target.value as AmendmentType); setFieldError(""); }}
          >
            {AMENDMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>

        {(amendmentType === "quantity" || amendmentType === "price") && (
          <Field label="Line item *">
            <Select value={String(lineIdx)} onChange={(e) => setLineIdx(Number(e.target.value))}>
              {lineItems.map((li, i) => (
                <option key={`${li.itemCode}-${i}`} value={i}>
                  {li.itemCode} — {li.itemName} (qty {li.quantity} @ {formatMoney(li.unitPrice)})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {amendmentType === "quantity" && (
          <Field label="New quantity *">
            <Input type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} />
          </Field>
        )}

        {amendmentType === "price" && (
          <Field label="New unit price (₹) *">
            <Input type="number" min={0} step="0.01" value={newUnitPriceRupees} onChange={(e) => setNewUnitPriceRupees(e.target.value)} />
          </Field>
        )}

        {(amendmentType === "scope" || amendmentType === "change_order") && (
          <Field label={amendmentType === "change_order" ? "Value change (₹, use - to reduce) *" : "Value change (₹, use - to reduce)"}>
            <Input
              inputMode="decimal"
              placeholder="e.g. 5000 or -5000"
              value={deltaRupees}
              onChange={(e) => setDeltaRupees(e.target.value)}
            />
          </Field>
        )}

        {(amendmentType === "schedule") && (
          <Field label="New delivery / effective date *">
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
        )}

        {(amendmentType !== "schedule") && (
          <Field label="Effective date">
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
        )}
      </div>

      {/* Revised total preview (AMEND-04) */}
      <div style={{ margin: "12px 0", padding: "10px 12px", background: "var(--panel, #f8fafc)", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
          <span>Current total</span><span className="mono">{formatMoney(currentTotalMinor)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
          <span>Change</span>
          <span className="mono">{deltaMinor === null ? "—" : `${deltaMinor >= 0 ? "+" : ""}${formatMoney(deltaMinor)}`}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}>
          <span>Revised total</span>
          <span className="mono" style={{ color: belowZero ? "var(--bad)" : undefined }}>
            {revisedTotal === null ? "—" : formatMoney(revisedTotal)}
          </span>
        </div>
      </div>

      <Field label="Reason for amendment *">
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          placeholder="Describe the amendment and business justification (min 3 chars)"
        />
      </Field>

      <div role="status" aria-live="polite">
        {fieldError ? <p role="alert" style={{ marginTop: 8, color: "var(--bad)", fontSize: "0.875rem" }}>{fieldError}</p> : null}
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 8, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit amendment"}
        </Button>
        {/* AMEND-05: a real link, not history.back() (which can leave the app). */}
        <Link href={`/procurement/orders/${poId}`} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
