"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const FUEL_TYPES = ["petrol", "diesel", "electric", "cng"] as const;

type FieldErrors = {
  registrationNo?: string;
  make?: string;
  model?: string;
  year?: string;
};

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

export function RegisterVehicleForm() {
  const router = useRouter();

  const [registrationNo, setRegistrationNo] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [fuelType, setFuelType] = useState<(typeof FUEL_TYPES)[number]>("petrol");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const registrationId = useId();
  const makeId = useId();
  const modelId = useId();
  const yearId = useId();
  const fuelTypeId = useId();
  const registrationErrId = useId();
  const makeErrId = useId();
  const modelErrId = useId();
  const yearErrId = useId();

  const registrationRef = useRef<HTMLInputElement>(null);
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!registrationNo.trim()) next.registrationNo = "Registration number is required.";
    if (!make.trim()) next.make = "Make is required.";
    if (!model.trim()) next.model = "Model is required.";
    const yearNum = Number(year);
    if (!year.trim() || !Number.isInteger(yearNum)) {
      next.year = "Enter a valid year.";
    } else if (yearNum < 1950 || yearNum > new Date().getFullYear() + 1) {
      next.year = `Year must be between 1950 and ${new Date().getFullYear() + 1}.`;
    }

    setErrors(next);
    if (next.registrationNo) { registrationRef.current?.focus(); return false; }
    if (next.make) { makeRef.current?.focus(); return false; }
    if (next.model) { modelRef.current?.focus(); return false; }
    if (next.year) { yearRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function registerVehicle() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data?: { id: string; status: string } }>("v1/assets/fleet/vehicles", {
        method: "POST",
        body: JSON.stringify({
          registrationNo: registrationNo.trim(),
          make: make.trim(),
          model: model.trim(),
          year: Number(year),
          fuelType,
        }),
      });
      setConfirmOpen(false);
      setMessage(
        res?.data?.id
          ? `Vehicle ${registrationNo.trim()} registered (id ${res.data.id}).`
          : `Vehicle ${registrationNo.trim()} registered.`,
      );
      setRegistrationNo("");
      setMake("");
      setModel("");
      setYear(String(new Date().getFullYear()));
      setFuelType("petrol");
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
      <Card title="Register Vehicle" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={registrationId} style={{ fontSize: 13, fontWeight: 600 }}>
                Registration No. <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={registrationId}
                ref={registrationRef}
                value={registrationNo}
                onChange={(e) => setRegistrationNo(e.target.value)}
                maxLength={32}
                aria-required="true"
                aria-invalid={!!errors.registrationNo || undefined}
                aria-describedby={errors.registrationNo ? registrationErrId : undefined}
                style={inputStyle}
              />
              {errors.registrationNo && <p id={registrationErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.registrationNo}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={makeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Make <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={makeId}
                ref={makeRef}
                value={make}
                onChange={(e) => setMake(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={!!errors.make || undefined}
                aria-describedby={errors.make ? makeErrId : undefined}
                style={inputStyle}
              />
              {errors.make && <p id={makeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.make}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={modelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Model <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={modelId}
                ref={modelRef}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={!!errors.model || undefined}
                aria-describedby={errors.model ? modelErrId : undefined}
                style={inputStyle}
              />
              {errors.model && <p id={modelErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.model}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={yearId} style={{ fontSize: 13, fontWeight: 600 }}>
                Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={yearId}
                ref={yearRef}
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.year || undefined}
                aria-describedby={errors.year ? yearErrId : undefined}
                style={inputStyle}
              />
              {errors.year && <p id={yearErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.year}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fuelTypeId} style={{ fontSize: 13, fontWeight: 600 }}>Fuel Type</label>
              <select
                id={fuelTypeId}
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value as (typeof FUEL_TYPES)[number])}
                style={inputStyle}
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Register Vehicle
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
        title="Register this vehicle?"
        confirmLabel="Register vehicle"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Register <strong>{registrationNo}</strong> ({make} {model}, {year}, {fuelType}) to the fleet.
          </>
        }
        onConfirm={() => void registerVehicle()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
