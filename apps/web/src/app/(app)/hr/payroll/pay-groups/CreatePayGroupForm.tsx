"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Input, Select } from "../../../../_components/ds";
import { postWithErrorCode, patchWithErrorCode } from "../_lib/postWithErrorCode";
import { BILL_TYPES, isBillType, type BillType, type DdoOption } from "./payGroupMembership";
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
  /** Current DDO code (null = none) and bill type, when known. */
  ddoCode?: string | null;
  billType?: BillType | null;
};

/**
 * Create (no `editing`) or edit (`editing`) a pay group. GAP-PAYROLL-PAY-GROUPS-01:
 * the pay-day control follows the frequency -- a day of the month (or the last
 * day) for monthly, a weekday for weekly, a weekday plus which weeks for
 * bi-weekly. GAP-PAYROLL-PAY-GROUPS-03: edit sends PATCH with the full schedule.
 */
export function CreatePayGroupForm({
  editing,
  ddos = [],
  ddosUnavailable = false,
}: {
  editing?: EditablePayGroup;
  /** ACTIVE DDOs only -- the server rejects a pay group on an inactive DDO. */
  ddos?: DdoOption[];
  /** The DDO list could not be loaded: the DDO field is disabled and left out of the request. */
  ddosUnavailable?: boolean;
}) {
  const t = useTranslations("createPayGroupForm");
  const tv = useTranslations("hrFormErrors2");
  const tm = useTranslations("payGroupMembers");
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
  const [ddoCode, setDdoCode] = useState(editing?.ddoCode ?? "");
  const [billType, setBillType] = useState<BillType>(isBillType(editing?.billType) ? editing.billType : "other");
  // An already-linked DDO that has since been deactivated is not in the active
  // list; keep it selectable (by code) so editing the group doesn't silently unlink it.
  const ddoOptions =
    editing?.ddoCode && !ddos.some((d) => d.ddoCode === editing.ddoCode)
      ? [{ ddoCode: editing.ddoCode, name: editing.ddoCode }, ...ddos]
      : ddos;
  const ddoId = useId();
  const billTypeId = useId();
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
      const body = {
        name: savedName,
        timezone: timezone.trim(),
        ...payScheduleFields(schedule()),
        billType,
        // null clears the DDO on edit; on create "no DDO" is simply omitted.
        ...(ddosUnavailable ? {} : editing ? { ddoCode: ddoCode || null } : ddoCode ? { ddoCode } : {}),
      };
      const codeMessages = {
        DUPLICATE_NAME: t("duplicateNameError"),
        INVALID_STATE: t("inactiveEditError"),
        DDO_INACTIVE: t("ddoInactiveError"),
        DDO_NOT_FOUND: t("ddoNotFoundError"),
      };
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
        setDdoCode("");
      }
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }


  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} noValidate>
      <Card title={editing ? t("editFormTitle", { name: editing.name }) : t("formTitle")} padding>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <Field id={nameId} label={t("nameLabel")} required error={nameInvalid ? tv("fieldRequired") : undefined}>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
            />
          </Field>
          <Field id={freqId} label={t("frequencyLabel")}>
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
          </Field>

          {frequency === "monthly" ? (
            <Field id={dayId} label={t("payDayLabel")} required error={dayInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={dayRef}
                type="number"
                min={1}
                max={31}
                value={payDayOfMonth}
                disabled={lastDay}
                onChange={(e) => setPayDayOfMonth(e.target.value)}
                aria-describedby={[dayInvalid ? `${dayId}-error` : "", dayHintId].filter(Boolean).join(" ")}
              />
              <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input id={lastDayId} type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} />
                {t("lastDayLabel")}
              </label>
              <p id={dayHintId} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("payDayHintMonthly")}</p>
            </Field>
          ) : (
            <>
              <Field id={weekdayId} label={t("payWeekdayLabel")} required error={weekdayInvalid ? tv("fieldRequired") : undefined}>
                <Select
                  ref={weekdayRef}
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value)}
                  aria-describedby={weekdayInvalid ? `${weekdayId}-error` : dayHintId}
                >
                  <option value="">{t("payWeekdayPlaceholder")}</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={String(n)}>{weekdayName(n, locale)}</option>
                  ))}
                </Select>
                <p id={dayHintId} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
                  {frequency === "weekly" ? t("payDayHintWeekly") : t("payDayHintBiWeekly")}
                </p>
              </Field>
              {frequency === "bi_weekly" && (
                <Field id={parityId} label={t("payParityLabel")} required error={parityInvalid ? tv("fieldRequired") : undefined}>
                  <Select
                    ref={parityRef}
                    value={parity}
                    onChange={(e) => setParity(e.target.value)}
                  >
                    <option value="">{t("payParityPlaceholder")}</option>
                    <option value="1">{t("parityOdd")}</option>
                    <option value="0">{t("parityEven")}</option>
                  </Select>
                </Field>
              )}
            </>
          )}

          <Field id={tzId} label={t("timezoneLabel")} error={tzInvalid ? tv("invalidValue") : undefined}>
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <Field id={ddoId} label={t("ddoLabel")}>
            <Select
              value={ddoCode}
              disabled={ddosUnavailable}
              onChange={(e) => setDdoCode(e.target.value)}
            >
              <option value="">{t("ddoNone")}</option>
              {ddoOptions.map((d) => (
                <option key={d.ddoCode} value={d.ddoCode}>{`${d.name} (${d.ddoCode})`}</option>
              ))}
            </Select>
            <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{ddosUnavailable ? t("ddoUnavailableHint") : t("ddoHint")}</p>
          </Field>
          <Field id={billTypeId} label={t("billTypeLabel")}>
            <Select
              value={billType}
              onChange={(e) => setBillType(e.target.value as BillType)}
            >
              {BILL_TYPES.map((b) => (
                <option key={b} value={b}>{tm(`billType.${b}`)}</option>
              ))}
            </Select>
          </Field>
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
