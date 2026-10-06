"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, EntityPicker, Field, Input, PageHeader, Select } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { useFormError } from "@/lib/useFormError";

const FUEL_TYPES = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "cng", label: "CNG" },
  { value: "ev", label: "Electric (EV)" },
] as const;

type FieldErrors = { regNo?: string; makeModel?: string };

export default function NewVehiclePage() {
  const router = useRouter();
  const [regNo, setRegNo] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [fuelType, setFuelType] = useState("petrol");
  // GAP-ESTAB-VEHICLES-NEW-02: a chosen hrms employee id (or null = Pool),
  // selected via a searchable picker — no hand-typed UUIDs.
  const [allocatedTo, setAllocatedTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `done` stays true after a successful accept so the button never re-enables
  // during the redirect window (GAP-ESTAB-VEHICLES-NEW-03: double-submit guard).
  const [done, setDone] = useState(false);
  // A persistent error banner — NOT auto-dismissed (WCAG 2.2.1): it clears on
  // the next submit, never on a timer.
  const [submitError, setSubmitError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formError = useFormError("vehicle");

  const regNoRef = useRef<HTMLInputElement>(null);
  const makeModelRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || done) return; // hard double-submit guard
    setSubmitError("");

    // GAP-ESTAB-VEHICLES-NEW-04: validate every field at once, show per-field
    // messages, and move focus to the first invalid control.
    const normalisedRegNo = regNo.trim().toUpperCase();
    const errors: FieldErrors = {};
    if (!normalisedRegNo) errors.regNo = "Registration number is required.";
    if (!makeModel.trim()) errors.makeModel = "Make & model is required.";
    setFieldErrors(errors);
    if (errors.regNo) {
      regNoRef.current?.focus();
      return;
    }
    if (errors.makeModel) {
      makeModelRef.current?.focus();
      return;
    }

    setSubmitting(true);
    formError.clear();
    try {
      const payload = {
        regNo: normalisedRegNo,
        makeModel: makeModel.trim(),
        fuelType,
        ...(allocatedTo ? { allocatedTo } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        setDone(true);
        // GAP-ESTAB-VEHICLES-NEW-03: redirect immediately and tell the list to
        // revalidate (router.refresh busts the server data cache so the new
        // vehicle appears without waiting for revalidateSeconds to expire).
        router.push(`/estab/vehicles?added=${encodeURIComponent(normalisedRegNo)}`);
        router.refresh();
        return;
      }
      const result = await formError.fromResponse(res, "save");
      setSubmitError(result.message);
      setFieldErrors((prev) => ({
        ...prev,
        ...(result.fieldErrors.regNo ? { regNo: result.fieldErrors.regNo } : {}),
        ...(result.fieldErrors.makeModel ? { makeModel: result.fieldErrors.makeModel } : {}),
      }));
      setSubmitting(false);
    } catch (caught) {
      setSubmitError(formError.fromException("save", caught).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Add Vehicle"
        subtitle="Register a vehicle for fleet operations and allocation."
        back="/estab/vehicles"
        help="estab"
      />

      {submitError && (
        <div
          className="alert"
          role="alert"
          aria-live="assertive"
          style={{
            background: "var(--badbg)",
            border: "1px solid var(--badbd)",
            color: "var(--bad)",
            borderRadius: 12,
            padding: "13px 16px",
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          {submitError}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>Vehicle details</h3>
        </div>
        {/* noValidate: our own per-field messages replace the browser's native
            required bubbles (GAP-ESTAB-VEHICLES-NEW-04). */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="fields" style={{ display: "grid", gap: 14, padding: 16 }}>
            <Field label="Registration number" required error={fieldErrors.regNo}>
              <Input
                ref={regNoRef}
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                placeholder="e.g. DL 01 CA 1234"
              />
            </Field>
            <Field label="Make & model" required error={fieldErrors.makeModel}>
              <Input
                ref={makeModelRef}
                value={makeModel}
                onChange={(e) => setMakeModel(e.target.value)}
                placeholder="e.g. Toyota Innova Crysta"
              />
            </Field>
            <Field label="Fuel type">
              <Select value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
                {FUEL_TYPES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Allocated to">
              {/* GAP-ESTAB-VEHICLES-NEW-02: searchable officer picker (name +
                  designation), returns a real hrms id; clearing means Pool. No
                  hand-typed UUIDs. */}
              <EntityPicker
                value={allocatedTo}
                onChange={(v) => setAllocatedTo(Array.isArray(v) ? (v[0] ?? null) : v)}
                search={searchEmployees}
                resolve={resolveEmployees}
                placeholder="Search an officer by name — or leave blank for the pool"
                aria-label="Allocated to"
              />
            </Field>
          </div>
          <div
            className="pad"
            style={{ borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}
          >
            <Button type="submit" disabled={submitting || done}>
              {submitting || done ? "Adding…" : "Add Vehicle"}
            </Button>
            <a href="/estab/vehicles" className="btn ghost">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
