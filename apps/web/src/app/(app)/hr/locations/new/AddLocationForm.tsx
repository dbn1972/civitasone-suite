"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button } from "../../../../_components/ds";

interface Props {
  onCancel: () => void;
  onSuccess?: () => void;
}

const LOCATION_TYPES = [
  "state",
  "district",
  "block",
  "ward",
  "office",
  "facility",
  "branch",
] as const;

type LocationType = (typeof LOCATION_TYPES)[number];

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

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};

export function AddLocationForm({ onCancel, onSuccess }: Props) {
  const t = useTranslations("addLocationForm");
  const formId = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<LocationType>("office");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lgdCode, setLgdCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const formError = useFormError("location");

  const nameId = `${formId}-name`;
  const typeId = `${formId}-type`;
  const addressLineId = `${formId}-addressLine`;
  const cityId = `${formId}-city`;
  const postalCodeId = `${formId}-postalCode`;
  const lgdCodeId = `${formId}-lgdCode`;
  const statusId = `${formId}-status`;

  const typeLabels: Record<LocationType, string> = {
    state: t("typeState"),
    district: t("typeDistrict"),
    block: t("typeBlock"),
    ward: t("typeWard"),
    office: t("typeOffice"),
    facility: t("typeFacility"),
    branch: t("typeBranch"),
  };

  function handleCancel() {
    setName("");
    setType("office");
    setAddressLine("");
    setCity("");
    setPostalCode("");
    setLgdCode("");
    setMessage(null);
    setInvalid(new Set());
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const trimName = name.trim();
    const trimAddressLine = addressLine.trim();
    const trimCity = city.trim();
    const trimPostalCode = postalCode.trim();
    const trimLgdCode = lgdCode.trim();
    const errs = new Set<string>();

    if (trimName.length < 1 || trimName.length > 200) errs.add("name");
    if (trimAddressLine.length > 500) errs.add("addressLine");
    if (trimCity.length > 120) errs.add("city");
    if (trimPostalCode && !/^\d{1,6}$/.test(trimPostalCode)) errs.add("postalCode");
    if (trimLgdCode && (!/^\d+$/.test(trimLgdCode) || trimLgdCode.length > 32)) errs.add("lgdCode");

    if (errs.size > 0) {
      setInvalid(errs);
      setTone("error");
      setMessage(t("statusFixFields"));
      return;
    }

    setInvalid(new Set());
    setBusy(true);
    try {
      const body: Record<string, string> = { name: trimName, type };
      if (trimAddressLine) body.addressLine = trimAddressLine;
      if (trimCity) body.city = trimCity;
      if (trimPostalCode) body.postalCode = trimPostalCode;
      if (trimLgdCode) body.lgdCode = trimLgdCode;

      const res = await fetch("/api/proxy/v1/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setTone("error");
        setMessage(resolved.message);
        return;
      }

      setTone("success");
      setMessage(t("successMsg", { name: trimName }));
      setName("");
      setType("office");
      setAddressLine("");
      setCity("");
      setPostalCode("");
      setLgdCode("");
      onSuccess?.();
    } catch {
      setTone("error");
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={t("formAriaLabel")}
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>{t("cardHeading")}</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={statusId}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "var(--goodbg, #dcfce7)" : "#fee2e2",
                border: `1px solid ${
                  tone === "success" ? "var(--goodbd, #86efac)" : "var(--badbd, #fca5a5)"
                }`,
                color: tone === "success" ? "var(--good, #166534)" : "var(--bad, #b91c1c)",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {/* Name */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={nameId} style={labelStyle}>
              {t("nameLabel")}{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}>
                *
              </span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={200}
              required
              aria-required="true"
              aria-invalid={invalid.has("name")}
              style={inputStyle}
            />
          </div>

          {/* Type */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={typeId} style={labelStyle}>
              {t("typeLabel")}{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}>
                *
              </span>
            </label>
            <select
              id={typeId}
              value={type}
              onChange={(e) => setType(e.target.value as LocationType)}
              required
              aria-required="true"
              style={inputStyle}
            >
              {LOCATION_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {typeLabels[lt]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Address Line */}
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={addressLineId} style={labelStyle}>
            {t("addressLineLabel")}
          </label>
          <input
            id={addressLineId}
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder={t("addressLinePlaceholder")}
            maxLength={500}
            aria-invalid={invalid.has("addressLine")}
            style={inputStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          {/* City */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={cityId} style={labelStyle}>
              {t("cityLabel")}
            </label>
            <input
              id={cityId}
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("cityPlaceholder")}
              maxLength={120}
              aria-invalid={invalid.has("city")}
              style={inputStyle}
            />
          </div>

          {/* Postal Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={postalCodeId} style={labelStyle}>
              {t("postalCodeLabel")}
            </label>
            <input
              id={postalCodeId}
              type="text"
              inputMode="numeric"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder={t("postalCodePlaceholder")}
              maxLength={6}
              aria-invalid={invalid.has("postalCode")}
              style={inputStyle}
            />
          </div>

          {/* LGD Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={lgdCodeId} style={labelStyle}>
              {t("lgdCodeLabel")}
            </label>
            <input
              id={lgdCodeId}
              type="text"
              inputMode="numeric"
              value={lgdCode}
              onChange={(e) => setLgdCode(e.target.value)}
              placeholder={t("lgdCodePlaceholder")}
              maxLength={32}
              aria-invalid={invalid.has("lgdCode")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            type="submit"
            loading={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? t("addingBtn") : t("addBtn")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {t("cancelBtn")}
          </Button>
        </div>
      </div>
    </form>
  );
}
