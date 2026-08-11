"use client";

import { useId, useState } from "react";

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
  background: "#fff",
  color: "#0f172a",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
};

export function AddLocationForm({ onCancel, onSuccess }: Props) {
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

  const nameId = `${formId}-name`;
  const typeId = `${formId}-type`;
  const addressLineId = `${formId}-addressLine`;
  const cityId = `${formId}-city`;
  const postalCodeId = `${formId}-postalCode`;
  const lgdCodeId = `${formId}-lgdCode`;
  const statusId = `${formId}-status`;

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
      setMessage("Please fix the highlighted fields.");
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
        let detail = "";
        try {
          const json: unknown = await res.json();
          if (
            typeof json === "object" &&
            json !== null &&
            "message" in json
          ) {
            detail = String((json as Record<string, unknown>).message);
          }
        } catch {
          // ignore
        }
        throw new Error(detail || `Failed (${res.status})`);
      }

      setTone("success");
      setMessage(`Location "${trimName}" added successfully.`);
      setName("");
      setType("office");
      setAddressLine("");
      setCity("");
      setPostalCode("");
      setLgdCode("");
      onSuccess?.();
    } catch (err) {
      setTone("error");
      setMessage(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label="Add location"
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>Add Location</h3>
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
                background: tone === "success" ? "#dcfce7" : "#fee2e2",
                border: `1px solid ${
                  tone === "success" ? "#86efac" : "#fca5a5"
                }`,
                color: tone === "success" ? "#166534" : "#b91c1c",
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
              Name{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Block Development Office, Ranchi"
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
              Type{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
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
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Address Line */}
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={addressLineId} style={labelStyle}>
            Address Line
          </label>
          <input
            id={addressLineId}
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="e.g. 12 Main Street, Near Post Office"
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
              City
            </label>
            <input
              id={cityId}
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Ranchi"
              maxLength={120}
              aria-invalid={invalid.has("city")}
              style={inputStyle}
            />
          </div>

          {/* Postal Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={postalCodeId} style={labelStyle}>
              Postal Code
            </label>
            <input
              id={postalCodeId}
              type="text"
              inputMode="numeric"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="e.g. 834001"
              maxLength={6}
              aria-invalid={invalid.has("postalCode")}
              style={inputStyle}
            />
          </div>

          {/* LGD Code */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={lgdCodeId} style={labelStyle}>
              LGD Code
            </label>
            <input
              id={lgdCodeId}
              type="text"
              inputMode="numeric"
              value={lgdCode}
              onChange={(e) => setLgdCode(e.target.value)}
              placeholder="Local Government Directory code"
              maxLength={32}
              aria-invalid={invalid.has("lgdCode")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            aria-busy={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? "Adding…" : "Add Location"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleCancel}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
