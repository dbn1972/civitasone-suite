"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const QUARTER_TYPES = ["type_i", "type_ii", "type_iii", "type_iv", "type_v", "type_vi"] as const;

type FieldErrors = {
  quarterNo?: string;
  carpetAreaSqft?: string;
};

export function QuarterCreateForm() {
  const router = useRouter();

  const [quarterNo, setQuarterNo] = useState("");
  const [quarterType, setQuarterType] = useState<(typeof QUARTER_TYPES)[number]>("type_iv");
  const [category, setCategory] = useState("general");
  const [address, setAddress] = useState("");
  const [locality, setLocality] = useState("");
  const [carpetAreaSqft, setCarpetAreaSqft] = useState("");
  const [orgUnit, setOrgUnit] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const quarterNoField = useId();
  const quarterNoErrId = useId();
  const areaField = useId();
  const areaErrId = useId();
  const typeField = useId();
  const categoryField = useId();
  const addressField = useId();
  const localityField = useId();
  const orgUnitField = useId();

  const quarterNoRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!quarterNo.trim()) next.quarterNo = "Enter the quarter number.";
    if (carpetAreaSqft.trim()) {
      const n = parseInt(carpetAreaSqft, 10);
      if (!Number.isFinite(n) || n <= 0) next.carpetAreaSqft = "Carpet area must be a positive whole number of sq. ft.";
    }
    setErrors(next);
    if (next.quarterNo) { quarterNoRef.current?.focus(); return false; }
    if (next.carpetAreaSqft) { areaRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createQuarter() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ status: string }>("v1/estab/quarters", {
        method: "POST",
        body: JSON.stringify({
          quarterNo: quarterNo.trim(),
          quarterType,
          category: category.trim() || "general",
          address: address.trim() || undefined,
          locality: locality.trim() || undefined,
          carpetAreaSqft: carpetAreaSqft.trim() ? parseInt(carpetAreaSqft, 10) : undefined,
          orgUnit: orgUnit.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Quarter ${quarterNo.trim()} submitted to the inventory.`);
      setQuarterNo("");
      setQuarterType("type_iv");
      setCategory("general");
      setAddress("");
      setLocality("");
      setCarpetAreaSqft("");
      setOrgUnit("");
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
      <Card title="Add Quarter" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={quarterNoField} style={{ fontSize: 13, fontWeight: 600 }}>
                Quarter No. <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={quarterNoField}
                ref={quarterNoRef}
                value={quarterNo}
                onChange={(e) => setQuarterNo(e.target.value)}
                placeholder="e.g. B-14"
                aria-required="true"
                aria-invalid={!!errors.quarterNo || undefined}
                aria-describedby={errors.quarterNo ? quarterNoErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.quarterNo && <p id={quarterNoErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.quarterNo}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeField} style={{ fontSize: 13, fontWeight: 600 }}>Quarter Type</label>
              <select
                id={typeField}
                value={quarterType}
                onChange={(e) => setQuarterType(e.target.value as (typeof QUARTER_TYPES)[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {QUARTER_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={categoryField} style={{ fontSize: 13, fontWeight: 600 }}>Category</label>
              <input
                id={categoryField}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="general"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={areaField} style={{ fontSize: 13, fontWeight: 600 }}>Carpet Area (sq. ft.)</label>
              <input
                id={areaField}
                ref={areaRef}
                inputMode="numeric"
                value={carpetAreaSqft}
                onChange={(e) => setCarpetAreaSqft(e.target.value)}
                placeholder="e.g. 850"
                aria-invalid={!!errors.carpetAreaSqft || undefined}
                aria-describedby={errors.carpetAreaSqft ? areaErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.carpetAreaSqft && <p id={areaErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.carpetAreaSqft}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={localityField} style={{ fontSize: 13, fontWeight: 600 }}>Locality</label>
              <input
                id={localityField}
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                placeholder="e.g. Sector 12"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={addressField} style={{ fontSize: 13, fontWeight: 600 }}>Address</label>
              <input
                id={addressField}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Full address"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={orgUnitField} style={{ fontSize: 13, fontWeight: 600 }}>Org Unit</label>
              <input
                id={orgUnitField}
                value={orgUnit}
                onChange={(e) => setOrgUnit(e.target.value)}
                placeholder="Owning department/unit"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Add Quarter
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
        title="Add this quarter to the inventory?"
        confirmLabel="Add quarter"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Add quarter <strong>{quarterNo}</strong> ({quarterType.replace(/_/g, " ").toUpperCase()}, {category}) to
            the inventory.
          </>
        }
        onConfirm={() => void createQuarter()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
