"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FUEL_TYPES = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "cng", label: "CNG" },
  { value: "ev", label: "Electric (EV)" },
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 } as const;

export default function NewVehiclePage() {
  const router = useRouter();
  const [regNo, setRegNo] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [fuelType, setFuelType] = useState("petrol");
  const [allocatedTo, setAllocatedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [fieldError, setFieldError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");
    if (!regNo.trim()) { setFieldError("Registration number is required."); return; }
    if (!makeModel.trim()) { setFieldError("Make & model is required."); return; }
    if (allocatedTo.trim() && !UUID_RE.test(allocatedTo.trim())) {
      setFieldError("Allocated-to must be a valid officer ID (UUID), or leave it blank for the pool.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        regNo: regNo.trim(),
        makeModel: makeModel.trim(),
        fuelType,
        ...(allocatedTo.trim() ? { allocatedTo: allocatedTo.trim() } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        setToast({ type: "success", message: `Vehicle ${regNo.trim()} added to the fleet.` });
        setTimeout(() => router.push("/estab/vehicles"), 800);
      } else {
        const text = await res.text();
        setToast({ type: "error", message: text || `Error ${res.status}` });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <>
      <a className="back" href="/estab/vehicles">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>Add Vehicle</h1>
          <div className="sub">Register a vehicle for fleet operations (allocation, logbook, fuel).</div>
        </div>
      </div>

      {toast && (
        <div
          className="banner"
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          style={{
            background: toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fca5a5"}`,
            color: toast.type === "success" ? "#065f46" : "#991b1b",
            borderRadius: 12,
            padding: "13px 16px",
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          {toast.message}
        </div>
      )}

      <div className="card">
        <div className="card-h"><h3>Vehicle details</h3></div>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="regNo" className="l">Registration number <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="regNo" type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} required placeholder="e.g. DL 01 CA 1234" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="makeModel" className="l">Make &amp; model <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="makeModel" type="text" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} required placeholder="e.g. Toyota Innova Crysta" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="fuelType" className="l">Fuel type</label>
              <select id="fuelType" value={fuelType} onChange={(e) => setFuelType(e.target.value)} style={inputStyle}>
                {FUEL_TYPES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <label htmlFor="allocatedTo" className="l">Allocated to (optional)</label>
              <input id="allocatedTo" type="text" value={allocatedTo} onChange={(e) => setAllocatedTo(e.target.value)} placeholder="Officer ID (UUID) — leave blank for the pool" style={inputStyle} />
            </div>
          </div>
          {fieldError && (
            <div className="pad" role="alert" aria-live="assertive" style={{ color: "var(--bad)", fontSize: 13, paddingTop: 0 }}>{fieldError}</div>
          )}
          <div className="pad" style={{ borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <button type="submit" className="btn primary" disabled={submitting}>{submitting ? "Adding…" : "Add Vehicle"}</button>
            <a href="/estab/vehicles" className="btn ghost">Cancel</a>
          </div>
        </form>
      </div>
    </>
  );
}
