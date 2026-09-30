"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../_components/ds";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: React.CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: React.CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

type Fields = { name: string; date: string; type: string; applicableTo: string };
const INITIAL: Fields = { name: "", date: "", type: "gazetted", applicableTo: "all" };

interface Props {
  /** GAP-HR-HOLIDAYS-02: default the date input to the year currently being viewed. */
  year: number;
}

export function AddHolidayForm({ year }: Props) {
  const t = useTranslations("holidays");
  const ids = { name: useId(), date: useId(), type: useId(), applicableTo: useId() };
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(INITIAL);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const formError = useFormError("holiday");

  function set(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setInvalid((s) => { const n = new Set(s); n.delete(key); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!fields.name.trim()) errs.add("name");
    if (!fields.date) errs.add("date");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/holidays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fields.name.trim(),
          date: fields.date,
          type: fields.type,
          applicableTo: fields.applicableTo,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "bad", text: resolved.message });
        return;
      }
      // GAP-HR-HOLIDAYS-05: POST is queued (F3 write, 202) not applied
      // synchronously -- an immediate router.refresh() usually ran before the
      // consumer had inserted the row, so the new holiday silently failed to
      // appear with no cue that anything was still in flight. Say so
      // honestly, then refresh once more after the queue has had a moment.
      setMessage({ tone: "good", text: t("holidaySubmitted", { name: fields.name.trim() }) });
      setFields(INITIAL);
      setOpen(false);
      router.refresh();
      setTimeout(() => router.refresh(), 1500);
    } catch {
      setMessage({ tone: "bad", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>{t("addHoliday")}</h3>
        <Button
          type="button"
          size="sm"
          style={{ minHeight: 36 }}
          onClick={() => { setOpen((o) => !o); }}
          aria-expanded={open}
        >
          {open ? t("cancel") : t("addHolidayAction")}
        </Button>
      </div>

      {/* GAP-HR-HOLIDAYS-05: rendered outside the {open && ...} block below so
          the success/error message survives the form closing on submit --
          previously it lived inside that block and was unmounted the instant
          setOpen(false) ran, so it was never actually visible. */}
      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 12px" }}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>
          <div>
            <label htmlFor={ids.name} style={{ fontSize: 13, fontWeight: 500 }}>
              {t("fieldName")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
            </label>
            <input
              id={ids.name}
              ref={nameRef}
              type="text"
              placeholder={t("fieldNamePlaceholder")}
              value={fields.name}
              onChange={(e) => set("name", e.target.value)}
              style={invalid.has("name") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("name")}
              aria-describedby={invalid.has("name") ? `${ids.name}-err` : undefined}
              maxLength={120}
            />
            {invalid.has("name") && (
              <p id={`${ids.name}-err`} role="alert" style={fieldErrStyle}>
                {t("fieldNameError")}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.date} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("fieldDate")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input
                id={ids.date}
                type="date"
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                value={fields.date}
                onChange={(e) => set("date", e.target.value)}
                style={invalid.has("date") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("date")}
                aria-describedby={invalid.has("date") ? `${ids.date}-err` : undefined}
              />
              {invalid.has("date") && (
                <p id={`${ids.date}-err`} role="alert" style={fieldErrStyle}>
                  {t("fieldDateError")}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={ids.type} style={{ fontSize: 13, fontWeight: 500 }}>{t("fieldType")}</label>
              <select
                id={ids.type}
                value={fields.type}
                onChange={(e) => set("type", e.target.value)}
                style={inputStyle}
              >
                <option value="gazetted">{t("type.gazetted")}</option>
                <option value="restricted">{t("type.restricted")}</option>
                <option value="optional">{t("type.optional")}</option>
                <option value="weekly_off">{t("type.weekly_off")}</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={ids.applicableTo} style={{ fontSize: 13, fontWeight: 500 }}>{t("fieldApplicableTo")}</label>
            <input
              id={ids.applicableTo}
              type="text"
              placeholder="all"
              value={fields.applicableTo}
              onChange={(e) => set("applicableTo", e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="submit"
              disabled={busy}
              style={{ minHeight: 44, minWidth: 140 }}
            >
              {busy ? t("saving") : t("addHoliday")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
