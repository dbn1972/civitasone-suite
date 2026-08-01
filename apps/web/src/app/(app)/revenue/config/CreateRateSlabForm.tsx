"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { AcceptedResponse, SlabType } from "./types";

interface CreateRateSlabFormProps {
  rateHeadId: string;
  rateHeadLabel: string;
}

const SLAB_TYPES: { value: SlabType; label: string }[] = [
  { value: "flat", label: "Flat (fixed amount)" },
  { value: "ad_valorem", label: "Ad Valorem (percent of base value)" },
  { value: "band", label: "Band (slab-wise per unit)" },
];

type InvalidField = "bandFrom" | "rateValue" | "effectiveFrom" | null;

/** Rupees (as typed by the clerk) -> paise integer string. Never double-divide. */
function rupeesToPaiseString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100).toString();
}

/** Percent (as typed by the clerk) -> basis-points integer string. */
function percentToBpsString(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100).toString();
}

export function CreateRateSlabForm({ rateHeadId, rateHeadLabel }: CreateRateSlabFormProps) {
  const router = useRouter();
  const [slabType, setSlabType] = useState<SlabType>("flat");
  const [bandFrom, setBandFrom] = useState("");
  const [bandTo, setBandTo] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorText, setFieldErrorText] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const typeId = useId();
  const bandFromId = useId();
  const bandToId = useId();
  const rateValueId = useId();
  const fromId = useId();
  const toId = useId();
  const bandFromErrId = useId();
  const rateValueErrId = useId();
  const effectiveFromErrId = useId();
  const rateValueHintId = useId();
  const successId = useId();
  const rateValueRef = useRef<HTMLInputElement>(null);
  const bandFromRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  const rateValueLabel = slabType === "ad_valorem" ? "Rate (%)" : "Rate (₹)";
  const rateValueHint =
    slabType === "ad_valorem" ? "Enter a percentage from 0 to 100." : "Enter an amount in rupees.";
  const rateValueDescribedBy =
    invalidField === "rateValue" ? `${rateValueHintId} ${rateValueErrId}` : rateValueHintId;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);

    if (slabType === "band" && rupeesToPaiseString(bandFrom) === null) {
      setInvalidField("bandFrom");
      setFieldErrorText("Band From (₹) is required for band slabs and must be a non-negative amount.");
      bandFromRef.current?.focus();
      return;
    }

    const rateValuePaiseOrBps =
      slabType === "ad_valorem" ? percentToBpsString(rateValue) : rupeesToPaiseString(rateValue);
    if (rateValuePaiseOrBps === null) {
      setInvalidField("rateValue");
      setFieldErrorText(
        slabType === "ad_valorem"
          ? "Rate (%) is required and must be between 0 and 100."
          : "Rate (₹) is required and must be a non-negative amount.",
      );
      rateValueRef.current?.focus();
      return;
    }

    if (!effectiveFrom) {
      setInvalidField("effectiveFrom");
      setFieldErrorText("Effective From date is required.");
      fromRef.current?.focus();
      return;
    }

    setInvalidField(null);
    setFieldErrorText(null);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createRateSlab() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const rateValuePaiseOrBps =
        slabType === "ad_valorem" ? percentToBpsString(rateValue) : rupeesToPaiseString(rateValue);
      const body: Record<string, unknown> = {
        rateHeadId,
        slabType,
        rateValue: rateValuePaiseOrBps,
        effectiveFrom,
        effectiveTo: effectiveTo || undefined,
      };
      if (slabType === "band") {
        body.bandFrom = rupeesToPaiseString(bandFrom);
        const bandToPaise = rupeesToPaiseString(bandTo);
        if (bandToPaise !== null) body.bandTo = bandToPaise;
      }

      const res = await browserJson<AcceptedResponse>("v1/revenue/rate-slabs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConfirmOpen(false);
      setSuccessMessage(
        res.id
          ? `Rate slab submitted (id ${res.id}). It is processed asynchronously and will appear in the list shortly.`
          : "Rate slab submitted.",
      );
      setBandFrom("");
      setBandTo("");
      setRateValue("");
      setEffectiveFrom("");
      setEffectiveTo("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Rate Slab" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: 0 }}>
            For rate head <strong>{rateHeadLabel}</strong>.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Slab Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={typeId}
                value={slabType}
                onChange={(e) => setSlabType(e.target.value as SlabType)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {SLAB_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {slabType === "band" && (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={bandFromId} style={{ fontSize: 13, fontWeight: 600 }}>
                    Band From (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                  </label>
                  <input
                    id={bandFromId}
                    ref={bandFromRef}
                    inputMode="decimal"
                    value={bandFrom}
                    onChange={(e) => setBandFrom(e.target.value)}
                    aria-required="true"
                    aria-invalid={invalidField === "bandFrom" || undefined}
                    aria-describedby={invalidField === "bandFrom" ? bandFromErrId : undefined}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                  {invalidField === "bandFrom" && fieldErrorText && (
                    <p id={bandFromErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                      {fieldErrorText}
                    </p>
                  )}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={bandToId} style={{ fontSize: 13, fontWeight: 600 }}>Band To (₹)</label>
                  <input
                    id={bandToId}
                    inputMode="decimal"
                    value={bandTo}
                    onChange={(e) => setBandTo(e.target.value)}
                    placeholder="Leave blank for open-ended"
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                </div>
              </>
            )}

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={rateValueId} style={{ fontSize: 13, fontWeight: 600 }}>
                {rateValueLabel} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={rateValueId}
                ref={rateValueRef}
                inputMode="decimal"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                aria-required="true"
                aria-invalid={invalidField === "rateValue" || undefined}
                aria-describedby={rateValueDescribedBy}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              <span id={rateValueHintId} className="sr-only">{rateValueHint}</span>
              {invalidField === "rateValue" && fieldErrorText && (
                <p id={rateValueErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>
                Effective From <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fromId}
                ref={fromRef}
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                aria-required="true"
                aria-invalid={invalidField === "effectiveFrom" || undefined}
                aria-describedby={invalidField === "effectiveFrom" ? effectiveFromErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "effectiveFrom" && fieldErrorText && (
                <p id={effectiveFromErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={toId} style={{ fontSize: 13, fontWeight: 600 }}>Effective To</label>
              <input
                id={toId}
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Rate Slab
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
        title="Create this rate slab?"
        confirmLabel="Create rate slab"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create a <strong>{slabType}</strong> rate slab for <strong>{rateHeadLabel}</strong>, effective{" "}
            {effectiveFrom || "—"}.
          </>
        }
        onConfirm={() => void createRateSlab()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
