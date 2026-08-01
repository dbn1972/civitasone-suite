"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const PROTOCOLS = ["gt06", "teltonika", "queclink", "concox"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = {
  vehicleId?: string;
  deviceImei?: string;
};

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

export function RegisterDeviceForm() {
  const router = useRouter();

  const [vehicleId, setVehicleId] = useState("");
  const [deviceImei, setDeviceImei] = useState("");
  const [protocol, setProtocol] = useState<(typeof PROTOCOLS)[number]>("gt06");
  const [simIccid, setSimIccid] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const vehicleIdId = useId();
  const deviceImeiId = useId();
  const protocolId = useId();
  const simIccidId = useId();
  const vehicleIdErrId = useId();
  const deviceImeiErrId = useId();

  const vehicleIdRef = useRef<HTMLInputElement>(null);
  const deviceImeiRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!vehicleId.trim() || !UUID_RE.test(vehicleId.trim())) {
      next.vehicleId = "Enter a valid vehicle ID (UUID).";
    }
    if (deviceImei.trim().length !== 15) {
      next.deviceImei = "Device IMEI must be exactly 15 characters.";
    }

    setErrors(next);
    if (next.vehicleId) { vehicleIdRef.current?.focus(); return false; }
    if (next.deviceImei) { deviceImeiRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function registerDevice() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data?: { id: string; status: string } }>("v1/assets/fleet/devices", {
        method: "POST",
        body: JSON.stringify({
          vehicleId: vehicleId.trim(),
          deviceImei: deviceImei.trim(),
          protocol,
          simIccid: simIccid.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(
        res?.data?.id
          ? `Device ${deviceImei.trim()} registered (id ${res.data.id}).`
          : `Device ${deviceImei.trim()} registered.`,
      );
      setVehicleId("");
      setDeviceImei("");
      setSimIccid("");
      setProtocol("gt06");
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
      <Card title="Register IoT Device" padding>
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
              <label htmlFor={deviceImeiId} style={{ fontSize: 13, fontWeight: 600 }}>
                Device IMEI <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={deviceImeiId}
                ref={deviceImeiRef}
                value={deviceImei}
                onChange={(e) => setDeviceImei(e.target.value)}
                maxLength={15}
                aria-required="true"
                aria-invalid={!!errors.deviceImei || undefined}
                aria-describedby={errors.deviceImei ? deviceImeiErrId : undefined}
                style={inputStyle}
              />
              {errors.deviceImei && <p id={deviceImeiErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.deviceImei}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={protocolId} style={{ fontSize: 13, fontWeight: 600 }}>Protocol</label>
              <select
                id={protocolId}
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as (typeof PROTOCOLS)[number])}
                style={inputStyle}
              >
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={simIccidId} style={{ fontSize: 13, fontWeight: 600 }}>SIM ICCID</label>
              <input
                id={simIccidId}
                value={simIccid}
                onChange={(e) => setSimIccid(e.target.value)}
                maxLength={22}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Register Device
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
        title="Register this device?"
        confirmLabel="Register device"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Register device <strong>{deviceImei}</strong> ({protocol}) against vehicle <strong>{vehicleId}</strong>.
          </>
        }
        onConfirm={() => void registerDevice()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
