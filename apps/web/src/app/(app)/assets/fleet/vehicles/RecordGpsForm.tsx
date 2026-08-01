"use client";

/**
 * Manual GPS position entry for a vehicle.
 *
 * POST /v1/assets/fleet/vehicles/:id/gps (asset-service). This is an operator
 * entry form, not a device-ingest form — GPS position is more commonly pushed
 * by a telematics device (see the IoT Devices telemetry screen), but a fleet
 * manager can also record a manual position (e.g. a driver phoning in a
 * location) here. Per routes.ts as read at build time, this endpoint echoes
 * the submitted coordinates back with a 200 and does NOT publish a queue
 * event or persist to a store — see BACKEND FOLLOW-UPS in the PR body.
 */
import { useId, useRef, useState } from "react";
import { Card } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type FieldErrors = {
  vehicleId?: string;
  lat?: string;
  lng?: string;
};

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function RecordGpsForm() {
  const [vehicleId, setVehicleId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [lastPosition, setLastPosition] = useState<{ id: string; lat: number; lng: number; updatedAt: string } | null>(null);

  const vehicleIdId = useId();
  const latId = useId();
  const lngId = useId();
  const vehicleIdErrId = useId();
  const latErrId = useId();
  const lngErrId = useId();

  const vehicleIdRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!vehicleId.trim() || !UUID_RE.test(vehicleId.trim())) {
      next.vehicleId = "Enter a valid vehicle ID (UUID).";
    }
    const latNum = Number(lat);
    if (!lat.trim() || Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
      next.lat = "Latitude must be a number between -90 and 90.";
    }
    const lngNum = Number(lng);
    if (!lng.trim() || Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      next.lng = "Longitude must be a number between -180 and 180.";
    }

    setErrors(next);
    if (next.vehicleId) { vehicleIdRef.current?.focus(); return false; }
    if (next.lat) { latRef.current?.focus(); return false; }
    if (next.lng) { lngRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setIsError(false);
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await browserJson<{ data?: { id: string; lat: number; lng: number; updatedAt: string } }>(
        `v1/assets/fleet/vehicles/${vehicleId.trim()}/gps`,
        {
          method: "POST",
          body: JSON.stringify({ lat: Number(lat), lng: Number(lng) }),
        },
      );
      if (res?.data) setLastPosition(res.data);
      setMessage(`Position recorded for vehicle ${vehicleId.trim()}.`);
      setLat("");
      setLng("");
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <Card title="Record GPS Position" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={vehicleIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                Vehicle ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={vehicleIdId}
                ref={vehicleIdRef}
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.vehicleId || undefined}
                aria-describedby={errors.vehicleId ? vehicleIdErrId : undefined}
                style={inputStyle}
              />
              {errors.vehicleId && <p id={vehicleIdErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.vehicleId}</p>}
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
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy}>
              {busy ? "Recording…" : "Record Position"}
            </button>
          </div>

          {message && (
            <p role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className={`pill ${isError ? "bad" : "good"}`} style={{ width: "fit-content" }}>
              {message}
            </p>
          )}

          {lastPosition && (
            <div role="status" style={{ fontSize: 13 }}>
              <strong>Last recorded position</strong> — vehicle {lastPosition.id}: lat {lastPosition.lat}, lng {lastPosition.lng}, at {lastPosition.updatedAt}.
            </div>
          )}
        </div>
      </Card>
    </form>
  );
}
