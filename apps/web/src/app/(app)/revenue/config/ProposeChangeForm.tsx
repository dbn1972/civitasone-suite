"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/app/_components/ds";
import { todayIST } from "@/lib/formatters";
import { percentToBps, rupeesToMinorString } from "@/lib/money";
import { proposeConfig, proposedMessage, type ConfigKind } from "./proposeConfig";

export type ChangeTarget = {
  id: string;
  kind: ConfigKind;
  label: string;
  /** For slabs: decides whether the new rate is entered as a percentage or as rupees. */
  slabType?: "flat" | "ad_valorem" | "band";
};

const KIND_NOUN: Record<ConfigKind, string> = {
  rate_head: "Rate head",
  rate_slab: "Rate slab",
  penalty_rule: "Penalty rule",
  rebate_rule: "Rebate rule",
};

/**
 * Owner decision #2 (2026-10-26): edit = a NEW VERSION effective from a date
 * (the old row is end-dated, never rewritten); deactivate = an END-DATE. Both
 * are proposals that a different officer approves.
 */
export function ProposeChangeForm({ targets }: { targets: ChangeTarget[] }) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState<"revise" | "end_date">("end_date");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [rate, setRate] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [errors, setErrors] = useState<{ target?: string; date?: string; fields?: string }>({});

  const targetSelId = useId();
  const dateId = useId();
  const rateId = useId();
  const graceId = useId();
  const validId = useId();

  const target = targets.find((t) => t.id === targetId) ?? null;
  const canRevise = !!target && target.kind !== "rate_head";
  const effAction: "revise" | "end_date" = canRevise ? action : "end_date";
  const ratePercent = target?.kind === "penalty_rule" || target?.kind === "rebate_rule" || target?.slabType === "ad_valorem";

  function buildPayload(): Record<string, unknown> | null {
    if (effAction === "end_date" || !target) return {};
    const payload: Record<string, unknown> = {};
    if (target.kind === "rate_slab") {
      if (rate.trim()) {
        const v = ratePercent ? percentToBps(rate) : rupeesToMinorString(rate);
        if (v === null) return null;
        payload.rateValue = String(v);
      }
    } else if (target.kind === "penalty_rule") {
      if (rate.trim()) {
        const bps = percentToBps(rate);
        if (bps === null) return null;
        payload.annualRateBps = bps;
      }
      if (graceDays.trim()) payload.graceDays = Number(graceDays);
    } else if (target.kind === "rebate_rule") {
      if (rate.trim()) {
        const bps = percentToBps(rate);
        if (bps === null) return null;
        payload.discountBps = bps;
      }
      if (validUntil.trim()) payload.validUntilDaysBeforeDue = Number(validUntil);
    }
    return payload;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const next: typeof errors = {};
    if (!target) next.target = "Select the row to change.";
    if (!effectiveFrom) next.date = "Enter the date the change takes effect.";
    const payload = buildPayload();
    if (payload === null) next.fields = "Enter a valid rate.";
    else if (effAction === "revise" && Object.keys(payload).length === 0) next.fields = "Enter at least one new value for the new version.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !target || payload === null) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const res = await proposeConfig({ kind: target.kind, action: effAction, effectiveFrom, targetId: target.id, payload });
      setTone("good");
      setMessage(proposedMessage(effAction === "end_date" ? "Deactivation (end-date)" : "New version", res.id));
      setTargetId("");
      setRate("");
      setGraceDays("");
      setValidUntil("");
      setEffectiveFrom("");
      router.refresh();
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 16 }} aria-label="Propose a change to existing configuration">
      <Card title="Change or deactivate existing configuration" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Existing rows are never edited in place. A change ends the current row on the effective date and starts a
            new version; deactivating a row sets its end date. A second officer approves either before it applies.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={targetSelId} style={{ fontSize: 13, fontWeight: 600 }}>Row to change *</label>
              <select id={targetSelId} value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-required="true" aria-invalid={!!errors.target || undefined} style={field}>
                <option value="">Select a row…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{KIND_NOUN[t.kind]} — {t.label}</option>
                ))}
              </select>
              {errors.target && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.target}</p>}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>Effective from *</label>
              <input id={dateId} type="date" min={todayIST()} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} aria-required="true" aria-invalid={!!errors.date || undefined} style={field} />
              {errors.date && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.date}</p>}
            </div>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 18, flexWrap: "wrap" }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>What should happen?</legend>
            {canRevise && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
                <input type="radio" name="change-action" checked={effAction === "revise"} onChange={() => setAction("revise")} />
                New version
              </label>
            )}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
              <input type="radio" name="change-action" checked={effAction === "end_date"} onChange={() => setAction("end_date")} />
              End-date (deactivate)
            </label>
          </fieldset>

          {effAction === "revise" && target && (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={rateId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {target.kind === "penalty_rule" ? "New annual rate (%)" : target.kind === "rebate_rule" ? "New discount (%)" : ratePercent ? "New rate (%)" : "New rate (₹)"}
                </label>
                <input id={rateId} type="number" step="0.01" min="0" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} style={field} />
              </div>
              {target.kind === "penalty_rule" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={graceId} style={{ fontSize: 13, fontWeight: 600 }}>New grace days</label>
                  <input id={graceId} type="number" min="0" max="365" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} style={field} />
                </div>
              )}
              {target.kind === "rebate_rule" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={validId} style={{ fontSize: 13, fontWeight: 600 }}>New valid-until (days before due)</label>
                  <input id={validId} type="number" min="0" max="365" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={field} />
                </div>
              )}
            </div>
          )}
          {errors.fields && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{errors.fields}</p>}

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              Propose change
            </Button>
          </div>
          {message && (
            <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}
