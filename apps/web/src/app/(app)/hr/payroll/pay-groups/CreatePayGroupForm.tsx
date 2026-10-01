"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

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

export function CreatePayGroupForm() {
  const t = useTranslations("createPayGroupForm");
  const FREQUENCIES = FREQUENCY_VALUES.map((value) => ({
    value,
    label: t(
      value === "monthly" ? "frequencyMonthly" : value === "bi_weekly" ? "frequencyBiWeekly" : "frequencyWeekly",
    ),
  }));
  const router = useRouter();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "bi_weekly" | "weekly">("monthly");
  const [payDayOfMonth, setPayDayOfMonth] = useState("28");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const nameId = useId();
  const freqId = useId();
  const dayId = useId();
  const tzId = useId();
  const dayHintId = useId();
  const errId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<"name" | "day" | "tz" | null>(null);
  const [zones] = useState(timeZoneOptions);
  const nameInvalid = tone === "bad" && invalidField === "name";
  const dayInvalid = tone === "bad" && invalidField === "day";
  const tzInvalid = tone === "bad" && invalidField === "tz";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    const day = parseInt(payDayOfMonth, 10);
    if (!name.trim()) {
      setTone("bad");
      setInvalidField("name");
      setMessage(t("nameRequiredError"));
      nameRef.current?.focus();
      return;
    }
    if (Number.isNaN(day) || day < 1 || day > 31) {
      setTone("bad");
      setInvalidField("day");
      setMessage(t("dayRangeError"));
      dayRef.current?.focus();
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

  async function createPayGroup() {
    setBusy(true);
    setDialogError(undefined);
    try {
      // POST is async (202 + command id) and does not echo the group back:
      // reading res.data.name threw after a successful create, showing an
      // error for a group that had in fact been saved.
      const createdName = name.trim();
      await browserJson<unknown>("v1/payroll/pay-groups", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          frequency,
          payDayOfMonth: parseInt(payDayOfMonth, 10),
          timezone: timezone.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("createdMessage", { name: createdName }));
      setName("");
      setPayDayOfMonth("28");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
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
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={freqId} style={{ fontSize: 13, fontWeight: 600 }}>{t("frequencyLabel")}</label>
            <select
              id={freqId}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "var(--panel, #fff)" }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
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
              onChange={(e) => setPayDayOfMonth(e.target.value)}
              aria-required="true"
              aria-invalid={dayInvalid || undefined}
              aria-describedby={[dayInvalid ? errId : "", dayHintId].filter(Boolean).join(" ")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {/* GAP-PAYROLL-PAY-GROUPS-01: say what the server actually does
                (payroll-service /calendar clamps 29-31 to the month's last
                day and schedules every group by day-of-month). */}
            <p id={dayHintId} style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
              {frequency === "monthly" ? t("payDayHintMonthly") : t("payDayHintNonMonthly")}
            </p>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tzId} style={{ fontSize: 13, fontWeight: 600 }}>{t("timezoneLabel")}</label>
            <select
              id={tzId}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              aria-invalid={tzInvalid || undefined}
              aria-describedby={tzInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "var(--panel, #fff)" }}
            >
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {t("createPayGroupBtn")}
          </Button>
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
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich("confirmDescription", {
          name,
          frequencyLabel: FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency,
          payDay: payDayOfMonth,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createPayGroup()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
