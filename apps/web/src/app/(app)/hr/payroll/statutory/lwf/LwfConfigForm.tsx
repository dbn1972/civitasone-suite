"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Input, Select } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { INDIAN_STATES_UTS } from "@/lib/india/states";
import { minorToDecimalString, nonNegativeRupeesToMinorString } from "@/lib/money";

// GAP-PAYROLL-STATUTORY-LWF-02: mirrors payroll-service LWF_FREQUENCIES
// (modules/payroll/state-rules.ts). "" = keep the stored frequency (or, for a
// state not configured yet, the server default).
const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
type Frequency = (typeof FREQUENCIES)[number];
const FREQUENCY_LABEL_KEY = {
  monthly: "frequencyMonthly",
  quarterly: "frequencyQuarterly",
  half_yearly: "frequencyHalfYearly",
  yearly: "frequencyYearly",
} as const;

function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
}

/**
 * GAP-PAYROLL-STATUTORY-LWF-05: a stored paise value (the GET state-rules rows
 * carry bigint columns, which arrive as strings) as a canonical non-negative
 * integer string, or null when absent/garbled.
 */
function storedMinor(v: number | string | null | undefined): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  return null;
}

/**
 * Rupee input -> paise, float-free (GAP2-PAYROLL-STATUTORY-CHALLANS-01: the
 * shared bigint-backed nonNegativeRupeesToMinorString family, never
 * `parseFloat(x) * 100`). GAP-PAYROLL-STATUTORY-LWF-05: a blank, non-numeric or
 * sub-paise entry (for example "1.005") is NOT mapped to 0 any more -- it is a
 * field error, because a silent zero would stop a state's LWF deduction.
 * ₹0 is a legitimate contribution, but it has to be typed.
 */
function parseAmount(raw: string): { ok: true; minor: number } | { ok: false; reason: "required" | "invalid" } {
  if (raw.trim() === "") return { ok: false, reason: "required" };
  const minor = nonNegativeRupeesToMinorString(raw);
  if (minor === null || !Number.isSafeInteger(Number(minor))) return { ok: false, reason: "invalid" };
  return { ok: true, minor: Number(minor) };
}

export type ExistingLwfConfig = {
  state_code: string;
  employee_contrib_minor?: number | string | null;
  employer_contrib_minor?: number | string | null;
  frequency?: string | null;
};

type SavePayload = {
  stateCode: string;
  lwfEmployee?: number;
  lwfEmployer?: number;
  lwfFrequency?: Frequency;
};

type FieldErrors = { stateCode?: string; emp?: string; er?: string };

const sameState = (a: string, b: string) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

/**
 * GAP-PAYROLL-STATUTORY-LWF-05 [HUMAN REVIEW: statutory compliance]:
 *  - the state is picked from the state / UT list (the codes payroll-service
 *    accepts), not typed, so an unknown code can no longer reach the confirm
 *    step;
 *  - both contribution amounts are required (a blank, malformed or sub-paise
 *    amount blocks submit with a field error; ₹0 must be typed);
 *  - choosing a state that is already configured fills in the stored amounts
 *    and frequency, and the confirm dialog warns that saving replaces them.
 *    Only the values the user actually changed are sent, so a concurrent edit
 *    to another field of the same state is never overwritten with a stale
 *    copy (the server still COALESCEs omitted fields -- GAP-...-LWF-02).
 */
export function LwfConfigForm({ existingConfigs = [] }: { existingConfigs?: ExistingLwfConfig[] }) {
  const t = useTranslations("lwfConfigForm");
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [empContrib, setEmpContrib] = useState("");
  const [erContrib, setErContrib] = useState("");
  const [frequency, setFrequency] = useState<Frequency | "">("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<SavePayload | null>(null);
  const [isOverwrite, setIsOverwrite] = useState(false);

  const stateId = useId();
  const empId = useId();
  const erId = useId();
  const freqId = useId();
  const hintId = useId();
  const errId = useId();
  const stateRef = useRef<HTMLSelectElement>(null);
  const empRef = useRef<HTMLInputElement>(null);
  const erRef = useRef<HTMLInputElement>(null);

  // The selectable states: every current state / UT, plus any already-configured
  // code that is not in that list (a legacy alias such as OR) so it stays editable.
  const knownCodes = new Set(INDIAN_STATES_UTS.map((s) => s.code));
  const extraCodes = existingConfigs
    .map((c) => (c.state_code ?? "").trim().toUpperCase())
    .filter((c) => c !== "" && !knownCodes.has(c));

  function findExisting(code: string): ExistingLwfConfig | undefined {
    return existingConfigs.find((c) => sameState(c.state_code, code));
  }

  function onStateChange(code: string) {
    setStateCode(code);
    setErrors({});
    setMessage(null);
    const cfg = code ? findExisting(code) : undefined;
    // Fill in the stored values for an already-configured state; a new state starts empty.
    setEmpContrib(cfg ? (minorToDecimalString(storedMinor(cfg.employee_contrib_minor)) ?? "") : "");
    setErContrib(cfg ? (minorToDecimalString(storedMinor(cfg.employer_contrib_minor)) ?? "") : "");
    setFrequency(cfg && isFrequency(cfg.frequency) ? cfg.frequency : "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const code = stateCode.trim().toUpperCase();
    const next: FieldErrors = {};
    if (!code) next.stateCode = t("stateCodeRequiredError");
    const emp = parseAmount(empContrib);
    const er = parseAmount(erContrib);
    if (!emp.ok) next.emp = emp.reason === "required" ? t("amountRequiredError") : t("amountInvalidError");
    if (!er.ok) next.er = er.reason === "required" ? t("amountRequiredError") : t("amountInvalidError");
    setErrors(next);
    if (next.stateCode) { stateRef.current?.focus(); return; }
    if (next.emp) { empRef.current?.focus(); return; }
    if (next.er) { erRef.current?.focus(); return; }
    if (!emp.ok || !er.ok) return;

    const existing = findExisting(code);
    const payload: SavePayload = { stateCode: code };
    // A new state sends everything it has. An existing state sends only what
    // changed against the stored values (unknown stored value => send it).
    if (!existing || storedMinor(existing.employee_contrib_minor) !== String(emp.minor)) payload.lwfEmployee = emp.minor;
    if (!existing || storedMinor(existing.employer_contrib_minor) !== String(er.minor)) payload.lwfEmployer = er.minor;
    if (frequency && (!existing || existing.frequency !== frequency)) payload.lwfFrequency = frequency;

    if (payload.lwfEmployee === undefined && payload.lwfEmployer === undefined && payload.lwfFrequency === undefined) {
      setTone("bad");
      setMessage(t("noChangesError"));
      return;
    }
    setPending(payload);
    setIsOverwrite(!!existing);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveLwf() {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/state-rules", {
        method: "POST",
        body: JSON.stringify(pending),
      });
      setConfirmOpen(false);
      setTone("good");
      setErrors({});
      setMessage(t("savedMessage", { state: pending.stateCode }));
      setStateCode(""); setEmpContrib(""); setErContrib(""); setFrequency("");
      setPending(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const unchanged = t("unchangedValue");

  return (
    <form noValidate onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <Field id={stateId} label={t("stateCodeLabel")} required error={errors.stateCode}>
              <Select
                ref={stateRef}
                value={stateCode}
                onChange={(e) => onStateChange(e.target.value)}
                aria-describedby={hintId}
              >
                <option value="">{t("stateCodePlaceholder")}</option>
                {INDIAN_STATES_UTS.map((s) => (
                  <option key={s.code} value={s.code}>{`${s.name} (${s.code})`}</option>
                ))}
                {extraCodes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field id={empId} label={t("employeeContributionLabel")} required error={errors.emp}>
              <Input
                ref={empRef}
                type="number"
                min="0"
                step="0.01"
                value={empContrib}
                onChange={(e) => setEmpContrib(e.target.value)}
                aria-describedby={hintId}
              />
            </Field>
            <Field id={erId} label={t("employerContributionLabel")} required error={errors.er}>
              <Input
                ref={erRef}
                type="number"
                min="0"
                step="0.01"
                value={erContrib}
                onChange={(e) => setErContrib(e.target.value)}
                aria-describedby={hintId}
              />
            </Field>
            <Field id={freqId} label={t("frequencyLabel")}>
              <Select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency | "")}
                aria-describedby={hintId}
              >
                <option value="">{t("frequencyKeepCurrent")}</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{t(FREQUENCY_LABEL_KEY[f])}</option>
                ))}
              </Select>
            </Field>
          </div>
          <p id={hintId} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("amountsRequiredHint")}</p>

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
            {t.rich("confirmDescription", {
              strong: (chunks) => <strong>{chunks}</strong>,
              state: pending?.stateCode ?? "",
              emp: pending?.lwfEmployee !== undefined ? formatMoney(pending.lwfEmployee) : unchanged,
              er: pending?.lwfEmployer !== undefined ? formatMoney(pending.lwfEmployer) : unchanged,
              frequency: pending?.lwfFrequency ? t(FREQUENCY_LABEL_KEY[pending.lwfFrequency]) : unchanged,
            })}
            {isOverwrite && (
              <>
                {" "}
                <strong>{t("overwriteWarning", { state: pending?.stateCode ?? "" })}</strong>
              </>
            )}
          </>
        }
        onConfirm={() => void saveLwf()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
