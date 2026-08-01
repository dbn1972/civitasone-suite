"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { AcceptedResponse } from "./types";

interface CreateRebateRuleFormProps {
  rateHeadId: string;
  rateHeadLabel: string;
}

const REBATE_TYPES = [
  { value: "early_payment", label: "Early Payment" },
  { value: "category", label: "Category" },
];

/** Percent (as typed by the clerk) -> basis-points integer, 1..10000 per the API contract. */
function percentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0.01 || n > 100) return null;
  return Math.round(n * 100);
}

/**
 * Whole, non-negative day count, 0..365. The backend's
 * `validUntilDaysBeforeDue` is `z.number().int().min(0).max(365)` with NO
 * `.optional()` — this field is REQUIRED, not "leave blank to skip".
 */
function toRequiredInt(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 365) return null;
  return n;
}

type InvalidField = "discount" | "validUntil" | null;

export function CreateRebateRuleForm({ rateHeadId, rateHeadLabel }: CreateRebateRuleFormProps) {
  const router = useRouter();
  const [rebateType, setRebateType] = useState("early_payment");
  const [discount, setDiscount] = useState("");
  const [validUntilDaysBeforeDue, setValidUntilDaysBeforeDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorText, setFieldErrorText] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const typeId = useId();
  const discountId = useId();
  const validUntilId = useId();
  const discountErrId = useId();
  const validUntilErrId = useId();
  const successId = useId();
  const discountRef = useRef<HTMLInputElement>(null);
  const validUntilRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);

    if (percentToBps(discount) === null) {
      setInvalidField("discount");
      setFieldErrorText("Discount (%) is required and must be between 0.01% and 100%.");
      discountRef.current?.focus();
      return;
    }

    if (toRequiredInt(validUntilDaysBeforeDue) === null) {
      setInvalidField("validUntil");
      setFieldErrorText("Valid Until (Days Before Due) is required and must be a whole number of days (0–365).");
      validUntilRef.current?.focus();
      return;
    }

    setInvalidField(null);
    setFieldErrorText(null);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createRebateRule() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/rebate-rules", {
        method: "POST",
        body: JSON.stringify({
          rateHeadId,
          rebateType,
          discountBps: percentToBps(discount),
          validUntilDaysBeforeDue: toRequiredInt(validUntilDaysBeforeDue),
        }),
      });
      setConfirmOpen(false);
      setSuccessMessage(
        res.id
          ? `Rebate rule submitted (id ${res.id}). It is processed asynchronously and will appear in the list shortly.`
          : "Rebate rule submitted.",
      );
      setDiscount("");
      setValidUntilDaysBeforeDue("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Rebate Rule" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: 0 }}>
            For rate head <strong>{rateHeadLabel}</strong>.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Rebate Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={typeId}
                value={rebateType}
                onChange={(e) => setRebateType(e.target.value)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {REBATE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={discountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Discount (%) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={discountId}
                ref={discountRef}
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                aria-required="true"
                aria-invalid={invalidField === "discount" || undefined}
                aria-describedby={invalidField === "discount" ? discountErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "discount" && fieldErrorText && (
                <p id={discountErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={validUntilId} style={{ fontSize: 13, fontWeight: 600 }}>
                Valid Until (Days Before Due) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={validUntilId}
                ref={validUntilRef}
                inputMode="numeric"
                value={validUntilDaysBeforeDue}
                onChange={(e) => setValidUntilDaysBeforeDue(e.target.value)}
                placeholder="e.g. 15"
                aria-required="true"
                aria-invalid={invalidField === "validUntil" || undefined}
                aria-describedby={invalidField === "validUntil" ? validUntilErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "validUntil" && fieldErrorText && (
                <p id={validUntilErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Rebate Rule
            </button>
          </div>

          {successMessage && (
            <p id={successId} role="status" aria-live="polite" className="pill good" style={{ width: "fit-content" }}>
              {successMessage}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this rebate rule?"
        confirmLabel="Create rebate rule"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create a <strong>{rebateType}</strong> rebate rule of <strong>{discount || "—"}%</strong>, valid until{" "}
            <strong>{validUntilDaysBeforeDue || "—"}</strong> day(s) before due, for <strong>{rateHeadLabel}</strong>.
          </>
        }
        onConfirm={() => void createRebateRule()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
