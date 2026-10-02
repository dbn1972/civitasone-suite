"use client";

/**
 * GAP-HR-LOCATIONS-NEW-02: admin form for the HRMS geofence master
 * (hrms_office_locations) that GeoCheckInCard's office picker and the
 * geo-check-in distance check read. Posts to POST /v1/hrms/office-locations
 * (async write -- the row appears in the list after the consumer applies it).
 * Wrong coordinates silently break attendance validation, so submit goes
 * through a confirmation that echoes the coordinates with a map link.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import {
  RADIUS_DEFAULT_METERS,
  RADIUS_MAX_METERS,
  RADIUS_MIN_METERS,
  mapPreviewUrl,
  validateOfficeLocation,
  type OfficeLocationBody,
  type OfficeLocationField,
} from "./officeLocationValidation";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  minHeight: 44,
};
const errStyle: React.CSSProperties = { fontSize: 12, color: "var(--bad, #b91c1c)" };

export function OfficeLocationForm() {
  const t = useTranslations("officeLocations");
  const router = useRouter();
  const formId = useId();
  const formError = useFormError("office location");

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(String(RADIUS_DEFAULT_METERS));
  const [errors, setErrors] = useState<Partial<Record<OfficeLocationField, "required" | "invalid" | "range">>>({});
  const [pending, setPending] = useState<OfficeLocationBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function errorText(field: OfficeLocationField): string | undefined {
    const e = errors[field];
    if (!e) return undefined;
    switch (field) {
      case "name": return t("nameError");
      case "address": return t("addressError");
      case "latitude": return e === "range" ? t("latitudeRange") : t("latitudeError");
      case "longitude": return e === "range" ? t("longitudeRange") : t("longitudeError");
      case "radiusMeters": return t("radiusError", { min: RADIUS_MIN_METERS, max: RADIUS_MAX_METERS });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const result = validateOfficeLocation({ name, address, latitude, longitude, radiusMeters });
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ tone: "error", text: t("fixFields") });
      return;
    }
    setErrors({});
    setPending(result.body);
  }

  async function confirmCreate() {
    if (!pending) return;
    setBusy(true);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/office-locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMessage({ tone: "error", text: resolved.message });
        return;
      }
      setMessage({ tone: "success", text: t("submitted", { name: pending.name }) });
      setName("");
      setAddress("");
      setLatitude("");
      setLongitude("");
      setRadiusMeters(String(RADIUS_DEFAULT_METERS));
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: formError.fromException("save").message });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const field = (key: OfficeLocationField, label: string, value: string, set: (v: string) => void, extra?: { inputMode?: "decimal" | "numeric"; placeholder?: string; required?: boolean; hint?: string }) => {
    const id = `${formId}-${key}`;
    const err = errorText(key) ?? formError.fieldError(key);
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
          {label}
          {extra?.required !== false && <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}> *</span>}
        </label>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => set(e.target.value)}
          inputMode={extra?.inputMode}
          placeholder={extra?.placeholder}
          aria-required={extra?.required === false ? undefined : "true"}
          aria-invalid={!!err || undefined}
          aria-describedby={[extra?.hint ? `${id}-hint` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined}
          style={inputStyle}
        />
        {extra?.hint && <span id={`${id}-hint`} style={{ fontSize: 12, color: "var(--mut)" }}>{extra.hint}</span>}
        {err && <span id={`${id}-err`} role="alert" style={errStyle}>{err}</span>}
      </div>
    );
  };

  return (
    <>
      <Card title={t("formTitle")}>
        <form onSubmit={handleSubmit} noValidate aria-label={t("formTitle")} className="pad" style={{ display: "grid", gap: 16 }}>
          <div aria-live="polite" aria-atomic="true">
            {message && (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                style={{ margin: 0, padding: "10px 14px", borderRadius: 8, fontSize: 14, color: message.tone === "error" ? "var(--bad, #b91c1c)" : "var(--good, #166534)" }}
              >
                {message.text}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {field("name", t("nameLabel"), name, setName, { placeholder: t("namePlaceholder") })}
            {field("address", t("addressLabel"), address, setAddress, { required: false })}
            {field("latitude", t("latitudeLabel"), latitude, setLatitude, { inputMode: "decimal", placeholder: "28.6139" })}
            {field("longitude", t("longitudeLabel"), longitude, setLongitude, { inputMode: "decimal", placeholder: "77.2090" })}
            {field("radiusMeters", t("radiusLabel"), radiusMeters, setRadiusMeters, { inputMode: "numeric", hint: t("radiusHint", { min: RADIUS_MIN_METERS, max: RADIUS_MAX_METERS }) })}
          </div>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>{t("submit")}</Button>
          </div>
        </form>
      </Card>
      <ConfirmDialog
        open={pending !== null}
        title={t("confirmTitle")}
        description={
          pending ? (
            <>
              <p style={{ margin: "0 0 8px" }}>
                {t("confirmBody", { name: pending.name, latitude: pending.latitude, longitude: pending.longitude, radius: pending.radiusMeters })}
              </p>
              <a href={mapPreviewUrl(pending.latitude, pending.longitude)} target="_blank" rel="noopener noreferrer">{t("confirmMapLink")}</a>
            </>
          ) : undefined
        }
        confirmLabel={t("confirmAction")}
        busy={busy}
        onConfirm={() => { void confirmCreate(); }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
