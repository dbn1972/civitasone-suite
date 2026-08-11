"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Dept {
  id: string;
  code: string;
  name: string;
}

interface Desig {
  id: string;
  code: string;
  name: string;
}

interface Props {
  departments: Dept[];
  designations: Desig[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "#fff",
  color: "#0f172a",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
};

const EMPLOYEE_TYPES = [
  { value: "permanent",   label: "Permanent" },
  { value: "temporary",   label: "Temporary" },
  { value: "contract",    label: "Contract" },
  { value: "deputation",  label: "Deputation" },
  { value: "intern",      label: "Intern" },
  { value: "apprentice",  label: "Apprentice" },
  { value: "volunteer",   label: "Volunteer" },
];

export function AddEmployeeForm({ departments, designations }: Props) {
  const formId = useId();
  const router = useRouter();
  const photoRef = useRef<HTMLInputElement>(null);

  const [employeeNo, setEmployeeNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [gender, setGender] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [employeeType, setEmployeeType] = useState("permanent");
  const [photo, setPhoto] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const ids = {
    employeeNo: `${formId}-employeeNo`,
    fullName: `${formId}-fullName`,
    departmentId: `${formId}-departmentId`,
    designationId: `${formId}-designationId`,
    dateOfJoining: `${formId}-dateOfJoining`,
    gender: `${formId}-gender`,
    mobile: `${formId}-mobile`,
    email: `${formId}-email`,
    employeeType: `${formId}-employeeType`,
    status: `${formId}-status`,
  };

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage("Photo must be under 500 KB. Please resize and try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_W = 200, MAX_H = 250;
        let w = img.width, h = img.height;
        if (w > MAX_W || h > MAX_H) {
          const ratio = Math.min(MAX_W / w, MAX_H / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, w, h);
        setPhoto(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const errs = new Set<string>();
    if (!employeeNo.trim()) errs.add("employeeNo");
    if (!fullName.trim()) errs.add("fullName");
    if (!departmentId) errs.add("departmentId");
    if (!designationId) errs.add("designationId");
    if (!dateOfJoining) errs.add("dateOfJoining");
    if (!mobile.trim() || !PHONE_RE.test(mobile.trim())) errs.add("mobile");
    if (!email.trim() || !EMAIL_RE.test(email.trim())) errs.add("email");

    if (errs.size > 0) {
      setInvalid(errs);
      setMessage("Please fix the highlighted fields.");
      return;
    }

    setInvalid(new Set());
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        employeeNo: employeeNo.trim(),
        fullName: fullName.trim(),
        departmentId,
        designationId,
        dateOfJoining,
        employeeType: employeeType || "permanent",
      };
      if (gender) body.gender = gender;
      body.mobile = mobile.trim();
      body.email = email.trim();
      if (photo) body.photoDataUrl = photo;

      const res = await fetch("/api/proxy/v1/hrms/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let detail = "";
        try {
          const json: unknown = await res.json();
          if (
            typeof json === "object" &&
            json !== null &&
            "message" in json
          ) {
            detail = String((json as Record<string, unknown>).message);
          }
        } catch {
          // ignore
        }
        throw new Error(detail || `Failed (${res.status})`);
      }

      router.refresh();
      setSubmitted(true);
      setTimeout(() => { router.push("/hr/employees"); }, 1500);
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label="Add employee"
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>Employee Details</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 20 }}>
        {/* Error status region */}
        <div aria-live="polite" aria-atomic="true" id={ids.status}>
          {message && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: "#fee2e2",
                border: "1px solid #fca5a5",
                color: "#b91c1c",
              }}
            >
              ⚠️ {message}
            </p>
          )}
        </div>

        {submitted && <div style={{padding:"12px 16px", background:"#dcfce7", border:"1px solid #86efac", borderRadius:10, color:"#166534", marginBottom:16}}>Employee added successfully. Redirecting…</div>}

        {/* Photo upload */}
        <div style={{ display: "grid", gap: 6 }}>
          <label style={labelStyle}>Employee Photo</label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div
              onClick={() => photoRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") photoRef.current?.click(); }}
              role="button"
              tabIndex={0}
              aria-label="Upload employee photo"
              style={{
                width: "clamp(64px, 22vw, 90px)",
                aspectRatio: "9 / 11",
                height: "auto",
                border: photo ? "2px solid var(--primary, #0e9f6e)" : "2px dashed var(--line, #cbd5e1)",
                borderRadius: 8,
                background: photo ? "transparent" : "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {photo ? (
                <img src={photo} alt="Employee photo preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 11, padding: 6, lineHeight: 1.4 }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
                  <div>Click to upload</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: "#cbd5e1" }}>JPG / PNG</div>
                  <div style={{ fontSize: 10, color: "#cbd5e1" }}>max 500 KB</div>
                </div>
              )}
            </div>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handlePhotoChange}
            />
            {photo && (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  if (photoRef.current) photoRef.current.value = "";
                }}
                style={{ fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>

        {/* Row 1: Employee No + Full Name */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.employeeNo} style={labelStyle}>
              Employee No{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={ids.employeeNo}
              type="text"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="EMP-001"
              required
              aria-required="true"
              aria-invalid={invalid.has("employeeNo")}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.fullName} style={labelStyle}>
              Full Name{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={ids.fullName}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ravi Kumar Sharma"
              required
              aria-required="true"
              aria-invalid={invalid.has("fullName")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Row 2: Department + Designation */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.departmentId} style={labelStyle}>
              Department{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <select
              id={ids.departmentId}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
              aria-required="true"
              aria-invalid={invalid.has("departmentId")}
              style={inputStyle}
            >
              <option value="">— Select department —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} – {d.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.designationId} style={labelStyle}>
              Designation{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <select
              id={ids.designationId}
              value={designationId}
              onChange={(e) => setDesignationId(e.target.value)}
              required
              aria-required="true"
              aria-invalid={invalid.has("designationId")}
              style={inputStyle}
            >
              <option value="">— Select designation —</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} – {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Date of Joining + Type of Employee */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.dateOfJoining} style={labelStyle}>
              Date of Joining{" "}
              <span aria-hidden="true" style={{ color: "#b91c1c" }}>
                *
              </span>
            </label>
            <input
              id={ids.dateOfJoining}
              type="date"
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              required
              aria-required="true"
              aria-invalid={invalid.has("dateOfJoining")}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.employeeType} style={labelStyle}>
              Type of Employee
            </label>
            <select
              id={ids.employeeType}
              value={employeeType}
              onChange={(e) => setEmployeeType(e.target.value)}
              style={inputStyle}
            >
              {EMPLOYEE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 4: Gender + Mobile + Email */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.gender} style={labelStyle}>
              Gender
            </label>
            <select
              id={ids.gender}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Not specified —</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.mobile} style={labelStyle}>
              Mobile <span aria-hidden="true" style={{color:"#b91c1c"}}>*</span>
            </label>
            <input
              id={ids.mobile}
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              required
              aria-required="true"
              aria-invalid={invalid.has("mobile")}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.email} style={labelStyle}>
              Email <span aria-hidden="true" style={{color:"#b91c1c"}}>*</span>
            </label>
            <input
              id={ids.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="employee@example.gov.in"
              autoComplete="email"
              required
              aria-required="true"
              aria-invalid={invalid.has("email")}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            aria-busy={busy}
            style={{ minHeight: 44, minWidth: 140 }}
          >
            {busy ? "Saving…" : "Add Employee"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => { router.push("/hr/employees"); }}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
