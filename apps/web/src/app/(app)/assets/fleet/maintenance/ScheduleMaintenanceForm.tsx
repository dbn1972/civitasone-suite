"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const MAINTENANCE_TYPES = ["oil_change", "tire_rotation", "brake_inspection", "full_service", "battery_check"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = {
  vehicleId?: string;
  scheduledDate?: string;
  odometerThresholdKm?: string;
};

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

/** Custom date validator — required, must parse, must not be in the past. */
function validateScheduledDate(value: string): string | undefined {
  if (!value.trim()) return "Scheduled date is required.";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Enter a valid date.";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsed.getTime() < today.getTime()) return "Scheduled date cannot be in the past.";
  return undefined;
}

export function ScheduleMaintenanceForm() {
  const router = useRouter();

  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState<(typeof MAINTENANCE_TYPES)[number]>("oil_change");
  const [scheduledDate, setScheduledDate] = useState("");
  const [odometerThresholdKm, setOdometerThresholdKm] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const vehicleIdId = useId();
  const typeId = useId();
  const scheduledDateId = useId();
  const odometerId = useId();
  const vehicleIdErrId = useId();
  const scheduledDateErrId = useId();
  const odometerErrId = useId();

  const vehicleIdRef = useRef<HTMLInputElement>(null);
  const scheduledDateRef = useRef<HTMLInputElement>(null);
  const odometerRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!vehicleId.trim() || !UUID_RE.test(vehicleId.trim())) next.vehicleId = "Enter a valid vehicle ID (UUID).";
    const dateErr = validateScheduledDate(scheduledDate);
    if (dateErr) next.scheduledDate = dateErr;
    if (odometerThresholdKm.trim()) {
      const km = Number(odometerThresholdKm);
      if (!Number.isInteger(km) || km < 0) next.odometerThresholdKm = "Odometer threshold must be a whole number of km, zero or greater.";
    }

    setErrors(next);
    if (next.vehicleId) { vehicleIdRef.current?.focus(); return false; }
    if (next.scheduledDate) { scheduledDateRef.current?.focus(); return false; }
    if (next.odometerThresholdKm) { odometerRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function scheduleMaintenance() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data?: { id: string; status: string } }>("v1/assets/fleet/maintenance/schedule", {
        method: "POST",
        body: JSON.stringify({
          vehicleId: vehicleId.trim(),
          type,
          scheduledDate: new Date(`${scheduledDate}T00:00:00`).toISOString(),
          odometerThresholdKm: odometerThresholdKm.trim() ? Number(odometerThresholdKm) : undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(
        res?.data?.id
          ? `Maintenance scheduled for vehicle ${vehicleId.trim()} (id ${res.data.id}).`
          : `Maintenance scheduled for vehicle ${vehicleId.trim()}.`,
      );
      setVehicleId("");
      setScheduledDate("");
      setOdometerThresholdKm("");
      setType("oil_change");
      setErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Schedule Maintenance" padding>
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
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>Type</label>
              <select
                id={typeId}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof MAINTENANCE_TYPES)[number])}
                style={inputStyle}
              >
                {MAINTENANCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={scheduledDateId} style={{ fontSize: 13, fontWeight: 600 }}>
                Scheduled Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={scheduledDateId}
                ref={scheduledDateRef}
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.scheduledDate || undefined}
                aria-describedby={errors.scheduledDate ? scheduledDateErrId : undefined}
                style={inputStyle}
              />
              {errors.scheduledDate && <p id={scheduledDateErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.scheduledDate}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={odometerId} style={{ fontSize: 13, fontWeight: 600 }}>Odometer Threshold (km)</label>
              <input
                id={odometerId}
                ref={odometerRef}
                inputMode="numeric"
                value={odometerThresholdKm}
                onChange={(e) => setOdometerThresholdKm(e.target.value)}
                aria-invalid={!!errors.odometerThresholdKm || undefined}
                aria-describedby={errors.odometerThresholdKm ? odometerErrId : undefined}
                style={inputStyle}
              />
              {errors.odometerThresholdKm && <p id={odometerErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.odometerThresholdKm}</p>}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Schedule Maintenance
            </button>
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
        title="Schedule this maintenance job?"
        confirmLabel="Schedule maintenance"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Schedule a <strong>{type.replace(/_/g, " ")}</strong> job for vehicle <strong>{vehicleId}</strong> on{" "}
            <strong>{scheduledDate}</strong>.
          </>
        }
        onConfirm={() => void scheduleMaintenance()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
