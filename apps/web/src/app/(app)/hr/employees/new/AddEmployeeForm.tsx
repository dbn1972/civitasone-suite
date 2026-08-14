"use client";

import { useState, Fragment } from "react";
import Link from "next/link";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };
type EmpSummary = { id: string; name: string; designationName?: string };

interface Props {
  departments: Dept[];
  designations: Desig[];
  managers: EmpSummary[];
}

const ACCENT = "#047857";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
};

const fieldWrap: React.CSSProperties = { display: "grid", gap: 6 };

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "16px 24px",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 24,
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 22px",
  background: ACCENT,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 22px",
  background: "transparent",
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  minHeight: 44,
};

type FormData = {
  // Step 1
  fullName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other" | "";
  category: "UR" | "SC" | "ST" | "OBC" | "EWS" | "";
  disability: boolean;
  mobile: string;
  email: string;
  // Step 2
  employeeNo: string;
  departmentId: string;
  designationId: string;
  dateOfJoining: string;
  station: string;
  managerId: string;
  employeeType: "permanent" | "contractual" | "deputation" | "apprentice";
  // Step 3
  pan: string;
  aadhaarRef: string;
  pran: string;
  bankAccountNo: string;
  bankIfsc: string;
};

const INIT: FormData = {
  fullName: "",
  dateOfBirth: "",
  gender: "",
  category: "",
  disability: false,
  mobile: "",
  email: "",
  employeeNo: "",
  departmentId: "",
  designationId: "",
  dateOfJoining: "",
  station: "",
  managerId: "",
  employeeType: "permanent",
  pan: "",
  aadhaarRef: "",
  pran: "",
  bankAccountNo: "",
  bankIfsc: "",
};

const STEP_LABELS = [
  "Identity & Personal",
  "Job & Organisation",
  "Statutory & Finance",
];

const STRING_KEYS: (keyof FormData)[] = [
  "fullName", "dateOfBirth", "gender", "category", "mobile", "email",
  "employeeNo", "departmentId", "designationId", "dateOfJoining",
  "station", "managerId", "employeeType",
  "pan", "aadhaarRef", "pran", "bankAccountNo", "bankIfsc",
];

export function AddEmployeeForm({ departments, designations, managers }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<FormData>(INIT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (step === 1 && !form.fullName.trim()) return "Full Name is required.";
    if (step === 2) {
      if (!form.employeeNo.trim()) return "Employee No is required.";
      if (!form.departmentId) return "Department is required.";
      if (!form.designationId) return "Designation is required.";
      if (!form.dateOfJoining) return "Date of Joining is required.";
    }
    return null;
  }

  function handleNext() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => (s < 3 ? (s + 1) as 1 | 2 | 3 : s));
  }

  function handleBack() {
    setError(null);
    setStep((s) => (s > 1 ? (s - 1) as 1 | 2 | 3 : s));
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);

    const body: Record<string, unknown> = {};
    for (const k of STRING_KEYS) {
      const v = form[k];
      if (typeof v === "string" && v.trim() !== "") body[k] = v.trim();
    }
    body.disability = form.disability;

    try {
      const res = await fetch("/api/proxy/v1/hrms/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const j = await res.json();
          if (typeof j === "object" && j !== null && "message" in j) {
            msg = String((j as Record<string, unknown>).message);
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(msg);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await res.json();
      const id =
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        typeof (result as Record<string, unknown>).id === "string"
          ? (result as Record<string, unknown>).id as string
          : "unknown";
      setSuccess({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div
        style={{
          padding: 24,
          background: "#dcfce7",
          border: "1px solid #86efac",
          borderRadius: 8,
          color: "#166534",
          maxWidth: 520,
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
          Employee created successfully!
        </p>
        <p style={{ margin: "8px 0 16px", fontSize: 14 }}>
          Employee ID: <strong>{success.id}</strong>
        </p>
        <Link
          href="/hr/employees"
          style={{ color: ACCENT, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
        >
          ← View Employee Directory
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Page heading */}
      <div style={{ marginBottom: 24 }}>
        <h1
          id="page-heading"
          style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}
        >
          Add New Employee
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
          Complete all steps to create a new employee record.
        </p>
      </div>

      {/* Step bar */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 28 }}>
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = n < step;
          const active = n === step;
          return (
            <Fragment key={n}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 90,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: done || active ? ACCENT : "transparent",
                    border: `2px solid ${done || active ? ACCENT : "#cbd5e1"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: done || active ? "#fff" : "#94a3b8",
                    fontSize: done ? 16 : 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    color: active ? ACCENT : "#64748b",
                    textAlign: "center",
                    lineHeight: 1.3,
                  }}
                >
                  {label}
                </span>
              </div>
              {i < 2 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: n < step ? ACCENT : "#e2e8f0",
                    marginTop: 15,
                    minWidth: 16,
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Inline error */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 14,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {/* Step card */}
      <div style={cardStyle}>

        {/* ── Step 1: Identity & Personal ─────────────────────────────── */}
        {step === 1 && (
          <>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
                marginTop: 0,
                marginBottom: 20,
              }}
            >
              Step 1 — Identity &amp; Personal
            </h2>
            <div style={grid2}>
              <div style={fieldWrap}>
                <label htmlFor="ne-fullName" style={labelStyle}>
                  Full Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="ne-fullName"
                  type="text"
                  value={form.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  autoComplete="name"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-dob" style={labelStyle}>
                  Date of Birth
                </label>
                <input
                  id="ne-dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-gender" style={labelStyle}>
                  Gender
                </label>
                <select
                  id="ne-gender"
                  value={form.gender}
                  onChange={(e) =>
                    update("gender", e.target.value as FormData["gender"])
                  }
                  style={inputStyle}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-category" style={labelStyle}>
                  Reservation Category
                </label>
                <select
                  id="ne-category"
                  value={form.category}
                  onChange={(e) =>
                    update("category", e.target.value as FormData["category"])
                  }
                  style={inputStyle}
                >
                  <option value="">Select category</option>
                  <option value="UR">UR</option>
                  <option value="SC">SC</option>
                  <option value="ST">ST</option>
                  <option value="OBC">OBC</option>
                  <option value="EWS">EWS</option>
                </select>
              </div>
              <div style={{ ...fieldWrap, gridColumn: "span 2" }}>
                <label
                  htmlFor="ne-disability"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#0f172a",
                  }}
                >
                  <input
                    id="ne-disability"
                    type="checkbox"
                    checked={form.disability}
                    onChange={(e) => update("disability", e.target.checked)}
                    style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
                  />
                  PwBD — Persons with Benchmark Disability
                </label>
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-email" style={labelStyle}>
                  Official Email
                </label>
                <input
                  id="ne-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="employee@gov.in"
                  autoComplete="email"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-mobile" style={labelStyle}>
                  Mobile
                </label>
                <input
                  id="ne-mobile"
                  type="tel"
                  value={form.mobile}
                  onChange={(e) => update("mobile", e.target.value)}
                  placeholder="+91 98765 43210"
                  autoComplete="tel"
                  style={inputStyle}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Job & Organisation ──────────────────────────────── */}
        {step === 2 && (
          <>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
                marginTop: 0,
                marginBottom: 20,
              }}
            >
              Step 2 — Job &amp; Organisation
            </h2>
            <div style={grid2}>
              <div style={fieldWrap}>
                <label htmlFor="ne-empNo" style={labelStyle}>
                  Employee No <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="ne-empNo"
                  type="text"
                  value={form.employeeNo}
                  onChange={(e) => update("employeeNo", e.target.value)}
                  placeholder="e.g. NIC/2026/0001"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-dept" style={labelStyle}>
                  Department <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  id="ne-dept"
                  value={form.departmentId}
                  onChange={(e) => update("departmentId", e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-desig" style={labelStyle}>
                  Designation <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  id="ne-desig"
                  value={form.designationId}
                  onChange={(e) => update("designationId", e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select designation</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-doj" style={labelStyle}>
                  Date of Joining <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="ne-doj"
                  type="date"
                  value={form.dateOfJoining}
                  onChange={(e) => update("dateOfJoining", e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-station" style={labelStyle}>
                  Station / Office Location
                </label>
                <input
                  id="ne-station"
                  type="text"
                  value={form.station}
                  onChange={(e) => update("station", e.target.value)}
                  placeholder="e.g. CGO Complex, New Delhi"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-manager" style={labelStyle}>
                  Reporting Manager
                </label>
                <select
                  id="ne-manager"
                  value={form.managerId}
                  onChange={(e) => update("managerId", e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select manager</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...fieldWrap, gridColumn: "span 2" }}>
                <label htmlFor="ne-empType" style={labelStyle}>
                  Employee Type
                </label>
                <select
                  id="ne-empType"
                  value={form.employeeType}
                  onChange={(e) =>
                    update(
                      "employeeType",
                      e.target.value as FormData["employeeType"],
                    )
                  }
                  style={{ ...inputStyle, maxWidth: 300 }}
                >
                  <option value="permanent">Permanent</option>
                  <option value="contractual">Contractual</option>
                  <option value="deputation">Deputation</option>
                  <option value="apprentice">Apprentice</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* ── Step 3: Statutory & Finance ─────────────────────────────── */}
        {step === 3 && (
          <>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
                marginTop: 0,
                marginBottom: 20,
              }}
            >
              Step 3 — Statutory &amp; Finance
            </h2>
            <div style={grid2}>
              <div style={fieldWrap}>
                <label htmlFor="ne-pan" style={labelStyle}>
                  PAN
                </label>
                <input
                  id="ne-pan"
                  type="password"
                  autoComplete="off"
                  value={form.pan}
                  onChange={(e) => update("pan", e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-aadhaar" style={labelStyle}>
                  Aadhaar Ref
                </label>
                <input
                  id="ne-aadhaar"
                  type="password"
                  autoComplete="off"
                  value={form.aadhaarRef}
                  onChange={(e) => update("aadhaarRef", e.target.value)}
                  placeholder="Masked reference only"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-pran" style={labelStyle}>
                  PRAN / NPS ID
                </label>
                <input
                  id="ne-pran"
                  type="text"
                  value={form.pran}
                  onChange={(e) => update("pran", e.target.value)}
                  placeholder="12-digit PRAN"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-bank" style={labelStyle}>
                  Bank Account No
                </label>
                <input
                  id="ne-bank"
                  type="password"
                  autoComplete="off"
                  value={form.bankAccountNo}
                  onChange={(e) => update("bankAccountNo", e.target.value)}
                  placeholder="Account number"
                  style={inputStyle}
                />
              </div>
              <div style={fieldWrap}>
                <label htmlFor="ne-ifsc" style={labelStyle}>
                  IFSC Code
                </label>
                <input
                  id="ne-ifsc"
                  type="text"
                  value={form.bankIfsc}
                  onChange={(e) => update("bankIfsc", e.target.value.toUpperCase())}
                  placeholder="e.g. SBIN0001234"
                  maxLength={11}
                  style={inputStyle}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation buttons */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 20,
          justifyContent: "flex-end",
        }}
      >
        {step > 1 && (
          <button type="button" onClick={handleBack} style={ghostBtn}>
            ← Back
          </button>
        )}
        {step < 3 ? (
          <button type="button" onClick={handleNext} style={primaryBtn}>
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={submitting}
            aria-busy={submitting}
            style={{
              ...primaryBtn,
              opacity: submitting ? 0.72 : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Creating…" : "Create Employee Record"}
          </button>
        )}
      </div>
    </div>
  );
}
