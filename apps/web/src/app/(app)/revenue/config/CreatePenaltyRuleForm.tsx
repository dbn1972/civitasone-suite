"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import { proposeConfig, proposedMessage } from "./proposeConfig";
import { todayIST } from "@/lib/formatters";
import { percentToBps as sharedPercentToBps } from "@/lib/money";
import type { InterestType, RoundingMode } from "./types";

interface CreatePenaltyRuleFormProps {
  rateHeadId: string;
  rateHeadLabel: string;
}

const INTEREST_TYPES: { value: InterestType; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "compound", label: "Compound" },
];

const ROUNDING_MODES: { value: RoundingMode; label: string }[] = [
  { value: "round_half_up", label: "Round half up" },
  { value: "floor", label: "Floor" },
  { value: "ceil", label: "Ceiling" },
];

/** Percent (as typed by the clerk) -> basis-points integer, 1..10000 per the API contract (string parse, no float). */
function percentToBps(input: string): number | null {
  const bps = sharedPercentToBps(input);
  return bps === null || bps < 1 || bps > 10000 ? null : bps;
}

function toInt(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function CreatePenaltyRuleForm({ rateHeadId, rateHeadLabel }: CreatePenaltyRuleFormProps) {
  const router = useRouter();
  const [interestType, setInterestType] = useState<InterestType>("simple");
  const [annualRate, setAnnualRate] = useState("");
  const [graceDays, setGraceDays] = useState("0");
  const [capMonths, setCapMonths] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIST());
  const effId = useId();
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("round_half_up");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrorText, setFieldErrorText] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"annualRate" | "graceDays" | null>(null);

  const typeId = useId();
  const rateId = useId();
  const graceId = useId();
  const capId = useId();
  const roundingId = useId();
  const rateErrId = useId();
  const graceErrId = useId();
  const successId = useId();
  const rateRef = useRef<HTMLInputElement>(null);
  const graceRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);

    if (percentToBps(annualRate) === null) {
      setInvalidField("annualRate");
      setFieldErrorText("Annual Interest Rate (%) is required and must be between 0.01% and 100%.");
      rateRef.current?.focus();
      return;
    }
    if (toInt(graceDays) === null) {
      setInvalidField("graceDays");
      setFieldErrorText("Grace Days is required and must be a whole number of days (0–365).");
      graceRef.current?.focus();
      return;
    }

    setInvalidField(null);
    setFieldErrorText(null);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPenaltyRule() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const cap = toInt(capMonths);
      const res = await proposeConfig({
        kind: "penalty_rule",
        action: "create",
        effectiveFrom,
        payload: {
          rateHeadId,
          interestType,
          annualRateBps: percentToBps(annualRate),
          graceDays: toInt(graceDays),
          capMonths: cap ?? undefined,
          roundingMode,
        },
      });
      setConfirmOpen(false);
      setSuccessMessage(proposedMessage("Penalty rule", res.id));
      setAnnualRate("");
      setGraceDays("0");
      setCapMonths("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Propose Penalty Rule" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            For rate head <strong>{rateHeadLabel}</strong>.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Interest Type <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
              </label>
              <select
                id={typeId}
                value={interestType}
                onChange={(e) => setInterestType(e.target.value as InterestType)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {INTEREST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={rateId} style={{ fontSize: 13, fontWeight: 600 }}>
                Annual Interest Rate (%) <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                id={rateId}
                ref={rateRef}
                inputMode="decimal"
                value={annualRate}
                onChange={(e) => setAnnualRate(e.target.value)}
                aria-required="true"
                aria-invalid={invalidField === "annualRate" || undefined}
                aria-describedby={invalidField === "annualRate" ? rateErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "annualRate" && fieldErrorText && (
                <p id={rateErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={graceId} style={{ fontSize: 13, fontWeight: 600 }}>
                Grace Days <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                id={graceId}
                ref={graceRef}
                inputMode="numeric"
                value={graceDays}
                onChange={(e) => setGraceDays(e.target.value)}
                aria-required="true"
                aria-invalid={invalidField === "graceDays" || undefined}
                aria-describedby={invalidField === "graceDays" ? graceErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {invalidField === "graceDays" && fieldErrorText && (
                <p id={graceErrId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {fieldErrorText}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={capId} style={{ fontSize: 13, fontWeight: 600 }}>Cap (Months)</label>
              <input
                id={capId}
                inputMode="numeric"
                value={capMonths}
                onChange={(e) => setCapMonths(e.target.value)}
                placeholder="Leave blank for uncapped"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={roundingId} style={{ fontSize: 13, fontWeight: 600 }}>
                Rounding Mode <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
              </label>
              <select
                id={roundingId}
                value={roundingMode}
                onChange={(e) => setRoundingMode(e.target.value as RoundingMode)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {ROUNDING_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6, maxWidth: 240 }}>
            <label htmlFor={effId} style={{ fontSize: 13, fontWeight: 600 }}>
              Effective from <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <input
              id={effId}
              type="date"
              value={effectiveFrom}
              min={todayIST()}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              aria-required="true"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Changes are never made in place: the new rate applies from this date, after a second officer approves.
            </span>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              Propose Penalty Rule
            </Button>
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
        title="Propose this penalty rule?"
        confirmLabel="Propose penalty rule"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Propose a <strong>{interestType}</strong> penalty rule at <strong>{annualRate || "—"}%</strong> p.a. for{" "}
            <strong>{rateHeadLabel}</strong>.
          </>
        }
        onConfirm={() => void createPenaltyRule()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
