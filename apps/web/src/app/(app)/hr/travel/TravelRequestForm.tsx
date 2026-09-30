"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid var(--badbd, #ef4444)" };
const fieldErrStyle: CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };

type Fields = {
  purpose: string;
  destination: string;
  fromDate: string;
  toDate: string;
  mode: string;
  advanceRequired: string;
};

const INITIAL: Fields = {
  purpose: "", destination: "", fromDate: "", toDate: "",
  mode: "road", advanceRequired: "",
};

export function TravelRequestForm() {
  const t = useTranslations("travelForm");
  const ids = {
    purpose: useId(), destination: useId(), fromDate: useId(),
    toDate: useId(), mode: useId(), advanceRequired: useId(),
  };
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(INITIAL);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const formError = useFormError("travel request");

  function set(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setInvalid((s) => { const n = new Set(s); n.delete(key); return n; });
  }

  // GAP-HR-TRAVEL-03: mirrors the server's own travelRequestSchema
  // (social/routes.ts) exactly -- purpose min 5 (was: any non-empty
  // string, so a 1-3 char purpose passed here and only failed with a
  // generic save error after a round trip), destination min 2, and
  // advance (when provided) must be a valid paise-safe decimal.
  function validate(): boolean {
    const errs = new Set<string>();
    if (fields.purpose.trim().length < 5) errs.add("purpose");
    if (fields.destination.trim().length < 2) errs.add("destination");
    if (!fields.fromDate) errs.add("fromDate");
    if (!fields.toDate) errs.add("toDate");
    if (fields.fromDate && fields.toDate && fields.toDate < fields.fromDate) errs.add("toDate");
    if (fields.advanceRequired && rupeesToMinorString(fields.advanceRequired) === null) errs.add("advanceRequired");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        purpose: fields.purpose.trim(),
        destination: fields.destination.trim(),
        fromDate: fields.fromDate,
        toDate: fields.toDate,
        mode: fields.mode,
      };
      if (fields.advanceRequired) {
        // GAP-HR-TRAVEL-05: paise-safe decimal parse (lib/money.ts) instead
        // of Math.round(Number(x) * 100), which the codebase's own paise
        // rule (CLAUDE.md) forbids -- float multiplication mis-rounds
        // values like 1.005. rupeesToMinorString returns a decimal-safe
        // integer string; Number(...) here is safe since the route
        // (advanceRequired: z.number().int()) expects a plain integer, not
        // a bigint-sized value -- travel advances are well within
        // Number.MAX_SAFE_INTEGER.
        const minor = rupeesToMinorString(fields.advanceRequired);
        body.advanceRequired = Number(minor);
      }
      const res = await fetch("/api/proxy/v1/hrms/travel-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "bad", text: resolved.message });
        return;
      }
      setMessage({ tone: "good", text: t("successMessage") });
      setFields(INITIAL);
      setOpen(false);
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>{t("heading")}</h3>
        <Button
          type="button"
          size="sm"
          style={{ minHeight: 36 }}
          onClick={() => { setOpen((o) => !o); setMessage(null); }}
          aria-expanded={open}
        >
          {open ? t("cancelToggle") : t("newRequestToggle")}
        </Button>
      </div>

      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 8px" }}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.purpose} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("labelPurpose")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.purpose} type="text" maxLength={500} value={fields.purpose}
                onChange={(e) => set("purpose", e.target.value)}
                placeholder={t("placeholderPurpose")}
                style={invalid.has("purpose") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("purpose")}
                aria-describedby={invalid.has("purpose") ? `${ids.purpose}-err` : undefined} />
              {invalid.has("purpose") && <p id={`${ids.purpose}-err`} role="alert" style={fieldErrStyle}>{t("purposeInvalid")}</p>}
            </div>
            <div>
              <label htmlFor={ids.destination} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("labelDestination")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.destination} type="text" maxLength={200} value={fields.destination}
                onChange={(e) => set("destination", e.target.value)}
                placeholder={t("placeholderDestination")}
                style={invalid.has("destination") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("destination")}
                aria-describedby={invalid.has("destination") ? `${ids.destination}-err` : undefined} />
              {invalid.has("destination") && <p id={`${ids.destination}-err`} role="alert" style={fieldErrStyle}>{t("destinationInvalid")}</p>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.fromDate} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("labelFromDate")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.fromDate} type="date" value={fields.fromDate}
                onChange={(e) => set("fromDate", e.target.value)}
                style={invalid.has("fromDate") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("fromDate")} />
              {invalid.has("fromDate") && <p role="alert" style={fieldErrStyle}>{t("fromDateRequired")}</p>}
            </div>
            <div>
              <label htmlFor={ids.toDate} style={{ fontSize: 13, fontWeight: 500 }}>
                {t("labelToDate")} <span aria-hidden="true" style={{ color: "var(--bad, #ef4444)" }}>*</span>
              </label>
              <input id={ids.toDate} type="date" value={fields.toDate}
                onChange={(e) => set("toDate", e.target.value)}
                style={invalid.has("toDate") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("toDate")} />
              {invalid.has("toDate") && <p role="alert" style={fieldErrStyle}>{t("toDateInvalid")}</p>}
            </div>
            <div>
              <label htmlFor={ids.mode} style={{ fontSize: 13, fontWeight: 500 }}>{t("labelMode")}</label>
              <select id={ids.mode} value={fields.mode} onChange={(e) => set("mode", e.target.value)} style={inputStyle}>
                <option value="road">{t("modeRoad")}</option>
                <option value="rail">{t("modeRail")}</option>
                <option value="air">{t("modeAir")}</option>
                {/* GAP-HR-TRAVEL-03: the backend enum (social/routes.ts's
                    travelRequestSchema) has always accepted own_vehicle;
                    this option simply never existed here. */}
                <option value="own_vehicle">{t("modeOwnVehicle")}</option>
              </select>
            </div>
            <div>
              <label htmlFor={ids.advanceRequired} style={{ fontSize: 13, fontWeight: 500 }}>{t("labelAdvance")}</label>
              <input id={ids.advanceRequired} type="number" min={0} step="0.01" value={fields.advanceRequired}
                onChange={(e) => set("advanceRequired", e.target.value)}
                placeholder="0"
                style={invalid.has("advanceRequired") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("advanceRequired")} />
              {invalid.has("advanceRequired") && <p role="alert" style={fieldErrStyle}>{t("advanceInvalid")}</p>}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" disabled={busy} style={{ minHeight: 44, minWidth: 160 }}>
              {busy ? t("submitting") : t("submitRequest")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
