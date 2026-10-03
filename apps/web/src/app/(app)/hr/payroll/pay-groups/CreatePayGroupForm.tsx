"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { postWithErrorCode, patchWithErrorCode } from "../_lib/postWithErrorCode";
import { payScheduleFields, payScheduleProblem, weekdayName, type PayFrequency } from "./payGroupSchedule";

/**
 * GAP-PAYROLL-PAY-GROUPS-04: IANA zones the browser knows about (with a
 * fallback that always contains the default), so the field is a picker
 * rather than free text that accepted "Mars/Base".
 */
export function timeZoneOptions(): string[] {
  const fallback = ["Asia/Kolkata", "UTC"];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.("timeZone") ?? [];
    return zones.length ? [...new Set([...fallback, ...zones])] : fallback;
  } catch {
    return fallback;
  }
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

// UX-017: keys are the stable backend frequency codes, never translated --
// only used to look up which message key holds the display label. Same safe
// pattern as salary-revisions/page.tsx's REVISION_TYPE_KEYS.
const FREQUENCY_VALUES = ["monthly", "bi_weekly", "weekly"] as const;

export type EditablePayGroup = {
  id: string;
  name: string;
  frequency: PayFrequency;
  payDayOfMonth: number;
  payWeekday: number | null;
  payLastDay: boolean;
  payWeekParity: number | null;
  timezone: string;
};

/**
 * Create (no `editing`) or edit (`editing`) a pay group. GAP-PAYROLL-PAY-GROUPS-01:
 * the pay-day control follows the frequency -- a day of the month (or the last
 * day) for monthly, a weekday for weekly, a weekday plus which weeks for
 * bi-weekly. GAP-PAYROLL-PAY-GROUPS-03: edit sends PATCH with the full schedule.
 */
export function CreatePayGroupForm({ editing }: { editing?: EditablePayGroup }) {
  const t = useTranslations("createPayGroupForm");
  const locale = useLocale();
  const FREQUENCIES = FREQUENCY_VALUES.map((value) => ({
    value,
    label: t(
      value === "monthly" ? "frequencyMonthly" : value === "bi_weekly" ? "frequencyBiWeekly" : "frequencyWeekly",
    ),
  }));
  const router = useRouter();
  const [name, setName] = useState(editing?.name ?? "");
  const [frequency, setFrequency] = useState<PayFrequency>(editing?.frequency ?? "monthly");
  const [payDayOfMonth, setPayDayOfMonth] = useState(String(editing?.payDayOfMonth ?? 28));
  const [lastDay, setLastDay] = useState(editing?.payLastDay ?? false);
  const [weekday, setWeekday] = useState<string>(editing?.payWeekday != null ? String(editing.payWeekday) : "");
  const [parity, setParity] = useState<string>(editing?.payWeekParity != null ? String(editing.payWeekParity) : "");
  const [timezone, setTimezone] = useState(editing?.timezone ?? "Asia/Kolkata");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const freqId = useId();
  const dayId = useId();
  const lastDayId = useId();
  const weekdayId = useId();
  const parityId = useId();
  const tzId = useId();
  const dayHintId = useId();
  const errId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const weekdayRef = useRef<HTMLSelectElement>(null);
  const parityRef = useRef<HTMLSelectElement>(null);
  const [invalidField, setInvalidField] = useState<"name" | "day" | "weekday" | "parity" | "tz" | null>(null);
  const [zones] = useState(timeZoneOptions);
  const nameInvalid = tone === "bad" && invalidField === "name";
  const dayInvalid = tone === "bad" && invalidField === "day";
  const weekdayInvalid = tone === "bad" && invalidField === "weekday";
  const parityInvalid = tone === "bad" && invalidField === "parity";
  const tzInvalid = tone === "bad" && invalidField === "tz";

  const schedule = () => ({
    frequency,
    dayOfMonth: parseInt(payDayOfMonth, 10),
    lastDay,
    weekday: weekday ? Number(weekday) : null,
    parity: parity === "" ? null : Number(parity),
  });

  function scheduleSummary(): string {
    if (frequency === "monthly") return lastDay ? t("summaryLastDay") : t("summaryDay", { day: payDayOfMonth });
    const wd = weekday ? weekdayName(Number(weekday), locale) : "—";
    if (frequency === "weekly") return t("summaryWeekly", { weekday: wd });
    return t("summaryBiWeekly", { weekday: wd, weeks: parity === "0" ? t("parityEven") : t("parityOdd") });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!name.trim()) {
      setTone("bad");
      setInvalidField("name");
      setMessage(t("nameRequiredError"));
      nameRef.current?.focus();
      return;
    }
    const problem = payScheduleProblem(schedule());
    if (problem) {
      setTone("bad");
      setMessage(t(problem));
      if (problem === "dayRangeError") { setInvalidField("day"); dayRef.current?.focus(); }
      else if (problem === "weekdayRequiredError") { setInvalidField("weekday"); weekdayRef.current?.focus(); }
      else { setInvalidField("parity"); parityRef.current?.focus(); }
      return;
    }
    if (!isValidTimeZone(timezone)) {
      setTone("bad");
      setInvalidField("tz");
      setMessage(t("timezoneInvalidError"));
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setDialogError(undefined);
    try {
      // POST/PATCH are async (202 + command id) and do not echo the group
      // back: reading res.data.name threw after a successful create, showing
      // an error for a group that had in fact been saved.
      const savedName = name.trim();
      const body = { name: savedName, timezone: timezone.trim(), ...payScheduleFields(schedule()) };
      const codeMessages = { DUPLICATE_NAME: t("duplicateNameError"), INVALID_STATE: t("inactiveEditError") };
      if (editing) {
        await patchWithErrorCode(`v1/payroll/pay-groups/${editing.id}`, body, codeMessages, { area: t("saveArea"), statusAware: true });
      } else {
        await postWithErrorCode("v1/payroll/pay-groups", body, codeMessages, { area: t("saveArea"), statusAware: true });
      }
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t(editing ? "updatedMessage" : "createdMessage", { name: savedName }));
      if (!editing) {
        setName("");
        setPayDayOfMonth("28");
        setLastDay(false);
        setWeekday("");
        setParity("");
      }
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  const selectStyle = { ...fieldStyle, background: "var(--panel, #fff)" } as const;

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} noValidate>
      <Card title={editing ? t("editFormTitle", { name: editing.name }) : t("formTitle")} padding>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("nameLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={nameId}
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              aria-required="true"
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? errId : undefined}
              style={fieldStyle}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={freqId} style={{ fontSize: 13, fontWeight: 600 }}>{t("frequencyLabel")}</label>
            <select
              id={freqId}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
              style={selectStyle}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {frequency === "monthly" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dayId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("payDayLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dayId}
                ref={dayRef}
                type="number"
                min={1}
                max={31}
                value={payDayOfMonth}
                disabled={lastDay}
                onChange={(e) => setPayDayOfMonth(e.target.value)}
                aria-required="true"
                aria-invalid={dayInvalid || undefined}
                aria-describedby={[dayInvalid ? errId : "", dayHintId].filter(Boolean).join(" ")}
                style={fieldStyle}
              />
              <label htmlFor={lastDayId} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input id={lastDayId} type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} />
                {t("lastDayLabel")}
              </label>
              <p id={dayHintId} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("payDayHintMonthly")}</p>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={weekdayId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("payWeekdayLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <select
                  id={weekdayId}
                  ref={weekdayRef}
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value)}
                  aria-required="true"
                  aria-invalid={weekdayInvalid || undefined}
                  aria-describedby={weekdayInvalid ? errId : dayHintId}
                  style={selectStyle}
                >
                  <option value="">{t("payWeekdayPlaceholder")}</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={String(n)}>{weekdayName(n, locale)}</option>
                  ))}
                </select>
                <p id={dayHintId} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
                  {frequency === "weekly" ? t("payDayHintWeekly") : t("payDayHintBiWeekly")}
                </p>
              </div>
              {frequency === "bi_weekly" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor={parityId} style={{ fontSize: 13, fontWeight: 600 }}>
                    {t("payParityLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                  </label>
                  <select
                    id={parityId}
                    ref={parityRef}
                    value={parity}
                    onChange={(e) => setParity(e.target.value)}
                    aria-required="true"
                    aria-invalid={parityInvalid || undefined}
                    aria-describedby={parityInvalid ? errId : undefined}
                    style={selectStyle}
                  >
                    <option value="">{t("payParityPlaceholder")}</option>
                    <option value="1">{t("parityOdd")}</option>
                    <option value="0">{t("parityEven")}</option>
                  </select>
                </div>
              )}
            </>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tzId} style={{ fontSize: 13, fontWeight: 600 }}>{t("timezoneLabel")}</label>
            <select
              id={tzId}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              aria-invalid={tzInvalid || undefined}
              aria-describedby={tzInvalid ? errId : undefined}
              style={selectStyle}
            >
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {editing ? t("updatePayGroupBtn") : t("createPayGroupBtn")}
          </Button>
          {editing && (
            <Link href="/hr/payroll/pay-groups" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{t("cancelEdit")}</Link>
          )}
        </div>

        {message && (
          <p
            id={errId}
            role={tone === "bad" ? "alert" : "status"}
            aria-live={tone === "bad" ? "assertive" : "polite"}
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
        title={editing ? t("confirmUpdateTitle") : t("confirmTitle")}
        confirmLabel={editing ? t("confirmUpdateLabel") : t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich(editing ? "confirmUpdateDescription" : "confirmDescription", {
          name,
          frequencyLabel: FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency,
          payDay: scheduleSummary(),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void submit()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
