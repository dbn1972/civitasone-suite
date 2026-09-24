"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type PayGroupResponse = {
  data: { id: string; name: string; frequency: string; payDayOfMonth: number; timezone: string; status: string };
};

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
  const errId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<"name" | "day" | null>(null);
  const nameInvalid = tone === "bad" && invalidField === "name";
  const dayInvalid = tone === "bad" && invalidField === "day";

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
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createPayGroup() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<PayGroupResponse>("v1/payroll/pay-groups", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          frequency,
          payDayOfMonth: parseInt(payDayOfMonth, 10),
          timezone: timezone.trim() || "Asia/Kolkata",
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("createdMessage", { name: res.data.name }));
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
              aria-describedby={dayInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tzId} style={{ fontSize: 13, fontWeight: 600 }}>{t("timezoneLabel")}</label>
            <input
              id={tzId}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              maxLength={64}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
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
