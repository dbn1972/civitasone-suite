"use client";

/**
 * Manual telemetry entry for a device.
 *
 * POST /v1/assets/fleet/devices/:id/telemetry (asset-service). Telemetry is
 * normally pushed automatically by the device itself over its own protocol
 * (gt06/teltonika/queclink/concox) — this form lets an operator log a reading
 * by hand (e.g. from a driver's radio call) using the same accepted contract.
 * The endpoint publishes an `asset.fleet_device.telemetry` event and returns
 * 202 accepted; it does not echo back a stored reading, so there is no read
 * view here — see BACKEND FOLLOW-UPS for consumer status.
 */
import { useId, useRef, useState } from "react";
import { Card } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type FieldErrors = {
  deviceId?: string;
  lat?: string;
  lng?: string;
  speed?: string;
  heading?: string;
  fuelLevel?: string;
};

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TelemetryForm() {
  const [deviceId, setDeviceId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [speed, setSpeed] = useState("");
  const [heading, setHeading] = useState("");
  const [fuelLevel, setFuelLevel] = useState("");
  const [engineOn, setEngineOn] = useState(true);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const deviceIdId = useId();
  const latId = useId();
  const lngId = useId();
  const speedId = useId();
  const headingId = useId();
  const fuelLevelId = useId();
  const engineOnId = useId();
  const deviceIdErrId = useId();
  const latErrId = useId();
  const lngErrId = useId();
  const speedErrId = useId();
  const headingErrId = useId();
  const fuelLevelErrId = useId();

  const deviceIdRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const speedRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const fuelLevelRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!deviceId.trim() || !UUID_RE.test(deviceId.trim())) next.deviceId = "Enter a valid device ID (UUID).";
    const latNum = Number(lat);
    if (!lat.trim() || Number.isNaN(latNum) || latNum < -90 || latNum > 90) next.lat = "Latitude must be a number between -90 and 90.";
    const lngNum = Number(lng);
    if (!lng.trim() || Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) next.lng = "Longitude must be a number between -180 and 180.";
    const speedNum = Number(speed);
    if (!speed.trim() || Number.isNaN(speedNum) || speedNum < 0) next.speed = "Speed must be zero or greater.";
    const headingNum = Number(heading);
    if (!heading.trim() || Number.isNaN(headingNum) || headingNum < 0 || headingNum > 360) next.heading = "Heading must be a number between 0 and 360.";
    if (fuelLevel.trim()) {
      const fuelNum = Number(fuelLevel);
      if (Number.isNaN(fuelNum) || fuelNum < 0 || fuelNum > 100) next.fuelLevel = "Fuel level must be a number between 0 and 100.";
    }

    setErrors(next);
    if (next.deviceId) { deviceIdRef.current?.focus(); return false; }
    if (next.lat) { latRef.current?.focus(); return false; }
    if (next.lng) { lngRef.current?.focus(); return false; }
    if (next.speed) { speedRef.current?.focus(); return false; }
    if (next.heading) { headingRef.current?.focus(); return false; }
    if (next.fuelLevel) { fuelLevelRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setIsError(false);
    if (!validate()) return;
    setBusy(true);
    try {
      await browserJson(`v1/assets/fleet/devices/${deviceId.trim()}/telemetry`, {
        method: "POST",
        body: JSON.stringify({
          lat: Number(lat),
          lng: Number(lng),
          speed: Number(speed),
          heading: Number(heading),
          fuelLevel: fuelLevel.trim() ? Number(fuelLevel) : undefined,
          engineOn,
          timestamp: new Date().toISOString(),
        }),
      });
      setMessage(`Telemetry reading accepted for device ${deviceId.trim()}.`);
      setLat("");
      setLng("");
      setSpeed("");
      setHeading("");
      setFuelLevel("");
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <Card title="Log Telemetry Reading" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={deviceIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                Device ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={deviceIdId}
                ref={deviceIdRef}
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.deviceId || undefined}
                aria-describedby={errors.deviceId ? deviceIdErrId : undefined}
                style={inputStyle}
              />
              {errors.deviceId && <p id={deviceIdErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.deviceId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={latId} style={{ fontSize: 13, fontWeight: 600 }}>
                Latitude <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={latId}
                ref={latRef}
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.lat || undefined}
                aria-describedby={errors.lat ? latErrId : undefined}
                style={inputStyle}
              />
              {errors.lat && <p id={latErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.lat}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={lngId} style={{ fontSize: 13, fontWeight: 600 }}>
                Longitude <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={lngId}
                ref={lngRef}
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.lng || undefined}
                aria-describedby={errors.lng ? lngErrId : undefined}
                style={inputStyle}
              />
              {errors.lng && <p id={lngErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.lng}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={speedId} style={{ fontSize: 13, fontWeight: 600 }}>
                Speed (km/h) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={speedId}
                ref={speedRef}
                inputMode="decimal"
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.speed || undefined}
                aria-describedby={errors.speed ? speedErrId : undefined}
                style={inputStyle}
              />
              {errors.speed && <p id={speedErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.speed}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={headingId} style={{ fontSize: 13, fontWeight: 600 }}>
                Heading (°) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={headingId}
                ref={headingRef}
                inputMode="decimal"
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.heading || undefined}
                aria-describedby={errors.heading ? headingErrId : undefined}
                style={inputStyle}
              />
              {errors.heading && <p id={headingErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.heading}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fuelLevelId} style={{ fontSize: 13, fontWeight: 600 }}>Fuel Level (%)</label>
              <input
                id={fuelLevelId}
                ref={fuelLevelRef}
                inputMode="decimal"
                value={fuelLevel}
                onChange={(e) => setFuelLevel(e.target.value)}
                aria-invalid={!!errors.fuelLevel || undefined}
                aria-describedby={errors.fuelLevel ? fuelLevelErrId : undefined}
                style={inputStyle}
              />
              {errors.fuelLevel && <p id={fuelLevelErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.fuelLevel}</p>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                id={engineOnId}
                type="checkbox"
                checked={engineOn}
                onChange={(e) => setEngineOn(e.target.checked)}
              />
              <label htmlFor={engineOnId} style={{ fontSize: 13, fontWeight: 600 }}>Engine on</label>
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy}>
              {busy ? "Logging…" : "Log Telemetry"}
            </button>
          </div>

          {message && (
            <p role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className={`pill ${isError ? "bad" : "good"}`} style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}
