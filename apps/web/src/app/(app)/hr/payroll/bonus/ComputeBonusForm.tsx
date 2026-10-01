"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { applyBpsToMinor, rupeesToMinorString, percentToBps } from "@/lib/money";
import { recentFinancialYears } from "@/lib/fiscalYear";
import { parseBonusForm, BONUS_PCT_MIN_BPS, BONUS_PCT_MAX_BPS, type BonusFormField, type BonusPayload } from "./bonusSchema";

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

export function ComputeBonusForm() {
  const t = useTranslations("computeBonusForm");
  const router = useRouter();
  // GAP-PAYROLL-BONUS-03: the FY is a closed set of well-formed labels
  // (current + 4 previous) -- a free-text "2025-27" can no longer be typed.
  const [fyOptions] = useState(() => recentFinancialYears(5));
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [fy, setFy] = useState(() => fyOptions[1] ?? fyOptions[0] ?? "");
  const [basic, setBasic] = useState("");
  const [bonusPct, setBonusPct] = useState("8.33");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BonusPayload | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [invalidField, setInvalidField] = useState<BonusFormField | null>(null);

  const empId = useId();
  const fyId = useId();
  const basicId = useId();
  const pctId = useId();
  const errId = useId();
  const fyRef = useRef<HTMLSelectElement>(null);
  const basicRef = useRef<HTMLInputElement>(null);
  const pctRef = useRef<HTMLInputElement>(null);

  const isInvalid = (f: BonusFormField) => tone === "bad" && invalidField === f;

  // GAP-PAYROLL-BONUS-02: preview with the exact server formula on paise/bps
  // (no float multiplication).
  const previewAmountMinor = (() => {
    const b = rupeesToMinorString(basic);
    const bps = percentToBps(bonusPct);
    if (b === null || bps === null || bps < BONUS_PCT_MIN_BPS || bps > BONUS_PCT_MAX_BPS) return null;
    return applyBpsToMinor(BigInt(b), bps);
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    const result = parseBonusForm({ employeeId, fy, basic, bonusPct });
    if (!result.ok) {
      setTone("bad");
      setInvalidField(result.field);
      setMessage(t(result.messageKey));
      if (result.field === "fy") fyRef.current?.focus();
      else if (result.field === "basic") basicRef.current?.focus();
      else if (result.field === "bonusPct") pctRef.current?.focus();
      else document.getElementById(empId)?.focus();
      return;
    }
    setDialogError(undefined);
    setPending(result.payload);
  }

  async function computeBonus() {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      // POST /v1/payroll/bonus/compute is CQRS: 202 { id, status: "accepted" }.
      // The amount is computed by the consumer, so the confirmation quotes
      // the (identical-formula) preview rather than reading a field the
      // response never carries -- the old `res.data.bonus_amount_minor`
      // threw on every successful submit.
      await browserJson<{ id: string; status: string }>("v1/payroll/bonus/compute", {
        method: "POST",
        body: JSON.stringify({
          employeeId: pending.employeeId,
          fy: pending.fy,
          basicMinor: pending.basicMinor,
          bonusPct: pending.bonusPct,
        }),
      });
      const amount = formatMoney(applyBpsToMinor(BigInt(pending.basicMinor), pending.bonusBps));
      setPending(null);
      setTone("good");
      setInvalidField(null);
      setMessage(t("submittedMessage", { amount }));
      setEmployeeId(null);
      setEmployeeName(null);
      setBasic("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const employeeLabel = employeeName ?? pending?.employeeId ?? "";

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              {/* GAP-PAYROLL-BONUS-01: pick by name/code -- no free-text UUID. */}
              <EmployeePicker
                id={empId}
                value={employeeId}
                onChange={(id, option) => { setEmployeeId(id); setEmployeeName(option?.label ?? null); }}
                clearable
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={fyId}
                ref={fyRef}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                aria-required="true"
                aria-invalid={isInvalid("fy") || undefined}
                aria-describedby={isInvalid("fy") ? errId : undefined}
                style={inputStyle}
              >
                {fyOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={basicId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("basicSalaryLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={basicId}
                ref={basicRef}
                inputMode="decimal"
                value={basic}
                onChange={(e) => setBasic(e.target.value)}
                aria-required="true"
                aria-invalid={isInvalid("basic") || undefined}
                aria-describedby={isInvalid("basic") ? errId : undefined}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={pctId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("bonusPctLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={pctId}
                ref={pctRef}
                inputMode="decimal"
                value={bonusPct}
                onChange={(e) => setBonusPct(e.target.value)}
                aria-required="true"
                aria-invalid={isInvalid("bonusPct") || undefined}
                aria-describedby={isInvalid("bonusPct") ? errId : undefined}
                style={inputStyle}
              />
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("basicHelpText")}</p>

          {previewAmountMinor !== null && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>
              {t.rich("previewAmountText", { amount: formatMoney(previewAmountMinor), strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          )}

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("computeBonusBtn")}
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
        open={pending !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending
            ? t.rich("confirmDescription", {
                pct: String(pending.bonusPct),
                amount: formatMoney(pending.basicMinor),
                bonus: formatMoney(applyBpsToMinor(BigInt(pending.basicMinor), pending.bonusBps)),
                employee: employeeLabel,
                fy: pending.fy,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : null
        }
        onConfirm={() => void computeBonus()}
        onCancel={() => !busy && setPending(null)}
      />
    </form>
  );
}
