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
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { IST_OFFSET_MS } from "@/lib/formatters";
import { FleetPicker } from "../FleetPicker";
import type { PickerOption } from "../_data/labels";

type FieldErrors = {
  deviceId?: string;
  lat?: string;
  lng?: string;
  speed?: string;
  heading?: string;
  fuelLevel?: string;
  readingTime?: string;
};

/** "YYYY-MM-DDTHH:mm" for `instant` as seen in IST (datetime-local has no zone). */
export function istLocalInputValue(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Parse a datetime-local value as an IST wall-clock time -> ISO instant, or null. */
export function istInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = {
  /** Registered devices labelled "IMEI — vehicle" (GAP-ASSETS-FLEET-DEVICES-01). */
  options: PickerOption[];
  devicesError?: boolean;
};

export function TelemetryForm({ options, devicesError = false }: Props) {
  const [deviceId, setDeviceId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [speed, setSpeed] = useState("");
  const [heading, setHeading] = useState("");
  const [fuelLevel, setFuelLevel] = useState("");
  const [engineOn, setEngineOn] = useState(true);
  // GAP-ASSETS-FLEET-DEVICES-05: a delayed radio report can be back-dated; the
  // default is "now" in IST rather than the browser clock being sent silently.
  const [readingTime, setReadingTime] = useState(() => istLocalInputValue(new Date()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
  const readingTimeId = useId();
  const readingTimeErrId = useId();

  const deviceIdRef = useRef<HTMLSelectElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const speedRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const fuelLevelRef = useRef<HTMLInputElement>(null);
  const readingTimeRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!deviceId || !UUID_RE.test(deviceId)) next.deviceId = "Select a device.";
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
    const iso = istInputToIso(readingTime);
    if (!iso) next.readingTime = "Enter a valid reading time.";
    else if (new Date(iso).getTime() > Date.now() + 60_000) next.readingTime = "Reading time cannot be in the future.";

    setErrors(next);
    if (next.deviceId) { deviceIdRef.current?.focus(); return false; }
    if (next.lat) { latRef.current?.focus(); return false; }
    if (next.lng) { lngRef.current?.focus(); return false; }
    if (next.speed) { speedRef.current?.focus(); return false; }
    if (next.heading) { headingRef.current?.focus(); return false; }
    if (next.fuelLevel) { fuelLevelRef.current?.focus(); return false; }
    if (next.readingTime) { readingTimeRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  const selectedLabel = options.find((o) => o.id === deviceId)?.label ?? "the selected device";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function logReading() {
    const timestamp = istInputToIso(readingTime);
    if (!timestamp) return;
    setBusy(true);
    setDialogError(undefined);
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
          timestamp,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Telemetry reading accepted for ${selectedLabel}.`);
      setLat("");
      setLng("");
      setSpeed("");
      setHeading("");
      setFuelLevel("");
      setReadingTime(istLocalInputValue(new Date()));
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <Card title="Log Telemetry Reading" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <FleetPicker
              id={deviceIdId}
              label="Device"
              options={options}
              value={deviceId}
              onChange={setDeviceId}
              error={errors.deviceId}
              errorId={deviceIdErrId}
              loadFailed={devicesError}
              emptyHint="No devices are registered yet — register one above."
              emptyHref="/assets/fleet/devices"
              selectRef={deviceIdRef}
            />

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

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={readingTimeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Reading time (IST) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={readingTimeId}
                ref={readingTimeRef}
                type="datetime-local"
                value={readingTime}
                onChange={(e) => setReadingTime(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.readingTime || undefined}
                aria-describedby={errors.readingTime ? readingTimeErrId : undefined}
                style={inputStyle}
              />
              {errors.readingTime && <p id={readingTimeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.readingTime}</p>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
              <input
                id={engineOnId}
                type="checkbox"
                checked={engineOn}
                onChange={(e) => setEngineOn(e.target.checked)}
                // WCAG 2.2 SC 2.5.8 Target Size Minimum: a native checkbox's
                // default box (and clickable space) is ~13x13px, well under
                // the required 24x24 -- UX-005 tranche 5.
                style={{ width: 24, height: 24, cursor: "pointer" }}
              />
              <label htmlFor={engineOnId} style={{ fontSize: 13, fontWeight: 600 }}>Engine on</label>
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              Log Telemetry
            </Button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Log this reading?"
        confirmLabel="Log reading"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Log a manual reading ({lat.trim()}, {lng.trim()}; {speed.trim()} km/h) for <strong>{selectedLabel}</strong> at{" "}
            <strong>{readingTime.replace("T", " ")} IST</strong>. It also updates the vehicle&apos;s last known position.
          </>
        }
        onConfirm={() => void logReading()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
