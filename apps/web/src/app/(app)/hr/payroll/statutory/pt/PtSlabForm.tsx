"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { postWithErrorCode } from "../../_lib/postWithErrorCode";
import { PT_NO_UPPER_BOUND_MINOR } from "./constants";
import { INDIAN_STATES_UTS } from "@/lib/india/states";
import { validatePtSlab, slabGaps, type ExistingPtSlab } from "@/lib/schemas/ptSlab";
import { formatMoney } from "@/lib/formatters";

type ExistingSlab = ExistingPtSlab;

/** Today as YYYY-MM-DD in IST (the statutory calendar), independent of the browser zone. */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/**
 * GAP-PAYROLL-STATUTORY-PT-04 [HUMAN REVIEW: statutory compliance]: two
 * client-side pre-checks so an inconsistent slab is caught before the confirm
 * dialog. Both mirror payroll-service EXACTLY (modules/payroll/state-rules.ts,
 * the authority since PR #1761 / GAP-PAYROLL-STATUTORY-PT-03):
 *   - range: "To" may not be below "From" (the server's ptSlab refine), so
 *     a single-amount slab where From equals To is allowed;
 *   - overlap: ranges are INCLUSIVE at both ends (two slabs that share even
 *     one boundary amount overlap), and an existing slab of the same state
 *     with the same "From" is the row this POST upserts, so it is excluded
 *     from the comparison (same as findPtSlabOverlap).
 * The server still re-checks (422 PT_SLAB_OVERLAP); this only saves a round
 * trip. Neither check invents or changes any statutory rate/threshold.
 *
 * fin-payroll-03: the state is now a picker over the state / UT list (the
 * server rejects any other code), validation lives in lib/schemas/ptSlab.ts
 * (zod, unit-tested), an "Effective from" date is sent and recorded, and a gap
 * left in the state's slab chain is shown as a warning in the confirm dialog.
 * Upsert semantics are settled by #1761: each slab is upserted on (state,
 * From) and the state's other slabs are kept.
 */
export function PtSlabForm({ existingSlabs = [] }: { existingSlabs?: ExistingSlab[] }) {
  const t = useTranslations("ptSlabForm");
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [slabFrom, setSlabFrom] = useState("0");
  const [slabTo, setSlabTo] = useState("");
  const [ptAmount, setPtAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  // Default to today once mounted (kept out of the initial render so the
  // server and client markup cannot disagree around midnight).
  useEffect(() => { setEffectiveFrom((v) => v || todayIst()); }, []);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: message is now translated display text, so it can no longer be
  // compared/prefix-matched directly to decide which field is invalid (same
  // bug class as CreateCorrectionForm.tsx/tranche 11) -- invalidField is a
  // stable, untranslated identity kept separately from the display string.
  const [invalidField, setInvalidField] = useState<"stateCode" | "ptAmount" | "slabTo" | null>(null);

  const stateId = useId();
  const fromId = useId();
  const toId = useId();
  const amtId = useId();
  const errId = useId();
  const effId = useId();
  const stateRef = useRef<HTMLSelectElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const stateInvalid = invalidField === "stateCode";
  const amtInvalid = invalidField === "ptAmount";
  const toInvalid = invalidField === "slabTo";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!stateCode.trim()) {
      setTone("bad");
      setMessage(t("stateCodeRequiredError"));
      setInvalidField("stateCode");
      stateRef.current?.focus();
      return;
    }
    const amt = parseFloat(ptAmount);
    if (Number.isNaN(amt) || amt < 0) {
      setTone("bad");
      setMessage(t("ptAmountInvalidError"));
      setInvalidField("ptAmount");
      amtRef.current?.focus();
      return;
    }

    const fromMinor = Math.round((parseFloat(slabFrom) || 0) * 100);
    const toMinor = slabTo.trim() ? Math.round(parseFloat(slabTo) * 100) : PT_NO_UPPER_BOUND_MINOR;
    const problem = validatePtSlab(
      { stateCode: stateCode.trim().toUpperCase(), fromMinor, toMinor, taxMinor: Math.round(amt * 100), ...(effectiveFrom ? { effectiveFrom } : {}) },
      existingSlabs,
    );
    if (problem) {
      setTone("bad");
      setMessage(
        problem.issue === "overlap" ? t("slabOverlapError")
        : problem.issue === "state" ? t("stateCodeInvalidError")
        : problem.issue === "amount" ? t("ptAmountInvalidError")
        : t("slabRangeInvalidError"),
      );
      setInvalidField(problem.field === "stateCode" ? "stateCode" : problem.field === "ptAmount" ? "ptAmount" : "slabTo");
      (problem.field === "stateCode" ? stateRef : problem.field === "ptAmount" ? amtRef : toRef).current?.focus();
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveSlab() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const fromMinor = Math.round((parseFloat(slabFrom) || 0) * 100);
      const toMinor = slabTo.trim() ? Math.round(parseFloat(slabTo) * 100) : PT_NO_UPPER_BOUND_MINOR;
      const taxMinor = Math.round((parseFloat(ptAmount) || 0) * 100);
      // GAP-PAYROLL-STATUTORY-PT-03: the server upserts this one slab on
      // (state, start) and keeps the state's other slabs; a range that
      // overlaps another slab is rejected (422 PT_SLAB_OVERLAP).
      await postWithErrorCode("v1/payroll/statutory/state-rules", {
        stateCode: stateCode.trim().toUpperCase(),
        ptSlabs: [{ fromMinor, toMinor, taxMinor }],
        ...(effectiveFrom ? { effectiveFrom } : {}),
      }, { PT_SLAB_OVERLAP: t("overlapError") }, { area: t("saveArea"), statusAware: true });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("savedMessage", { state: stateCode.trim().toUpperCase() }));
      setStateCode(""); setSlabFrom("0"); setSlabTo(""); setPtAmount(""); setEffectiveFrom(todayIst());
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const slabToDisplay = slabTo.trim() ? `₹${slabTo}` : t("noUpperBound");
  // Warn (never block) when the saved slab would leave a gap in the state's chain.
  const gapList = confirmOpen && stateCode
    ? slabGaps(
        {
          stateCode: stateCode.trim().toUpperCase(),
          fromMinor: Math.round((parseFloat(slabFrom) || 0) * 100),
          toMinor: slabTo.trim() ? Math.round(parseFloat(slabTo) * 100) : PT_NO_UPPER_BOUND_MINOR,
        },
        existingSlabs,
      )
    : [];

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={stateId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("stateCodeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={stateId}
                ref={stateRef}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                aria-required="true"
                aria-invalid={stateInvalid || undefined}
                aria-describedby={stateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "var(--panel, #fff)" }}
              >
                <option value="">{t("stateCodePlaceholder")}</option>
                {INDIAN_STATES_UTS.map((st) => (
                  <option key={st.code} value={st.code}>{`${st.name} (${st.code})`}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>{t("slabFromLabel")}</label>
              <input
                id={fromId}
                type="number" min="0" step="0.01"
                value={slabFrom}
                onChange={(e) => setSlabFrom(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={toId} style={{ fontSize: 13, fontWeight: 600 }}>{t("slabToLabel")}</label>
              <input
                id={toId}
                ref={toRef}
                type="number" min="0" step="0.01"
                value={slabTo}
                onChange={(e) => setSlabTo(e.target.value)}
                aria-invalid={toInvalid || undefined}
                aria-describedby={toInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("ptAmountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number" min="0" step="0.01"
                value={ptAmount}
                onChange={(e) => setPtAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={effId} style={{ fontSize: 13, fontWeight: 600 }}>{t("effectiveFromLabel")}</label>
              <input
                id={effId}
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                aria-describedby={`${effId}-note`}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              <p id={`${effId}-note`} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("effectiveFromNote")}</p>
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("submitBtn")}
            </Button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            <p style={{ margin: 0 }}>
              {t.rich("confirmDescription", {
                strong: (chunks) => <strong>{chunks}</strong>,
                state: stateCode.trim().toUpperCase(),
                from: slabFrom || 0,
                to: slabToDisplay,
                amount: ptAmount || 0,
              })}
            </p>
            {effectiveFrom && <p style={{ margin: "8px 0 0", fontSize: 13 }}>{t("confirmEffective", { date: effectiveFrom })}</p>}
            <p role="note" className="pill warn" style={{ margin: "8px 0 0", width: "fit-content" }}>{t("effectiveFromNote")}</p>
            {gapList.length > 0 && (
              <p role="note" className="pill warn" style={{ margin: "8px 0 0", width: "fit-content" }}>
                {t("gapWarning", { gaps: gapList.map((g) => `${formatMoney(g.fromMinor)}–${formatMoney(g.toMinor)}`).join(", ") })}
              </p>
            )}
          </>
        }
        onConfirm={() => void saveSlab()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
