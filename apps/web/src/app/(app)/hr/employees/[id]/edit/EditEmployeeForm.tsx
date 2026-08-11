"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeDetail } from "@civitasone/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

interface Props {
  employee: EmployeeDetail;
}

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

export function EditEmployeeForm({ employee }: Props) {
  const formId = useId();
  const router = useRouter();

  const [mobile, setMobile] = useState(employee.phone ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  const [managerId, setManagerId] = useState(employee.reportingTo ?? "");
  const [payStructureId, setPayStructureId] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("error");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  const ids = {
    mobile: `${formId}-mobile`,
    email: `${formId}-email`,
    managerId: `${formId}-managerId`,
    payStructureId: `${formId}-payStructureId`,
    status: `${formId}-status`,
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    const errs = new Set<string>();
    const trimmedEmail = email.trim();
    const trimmedMobile = mobile.trim();

    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) errs.add("email");
    if (trimmedMobile && !PHONE_RE.test(trimmedMobile)) errs.add("mobile");

    if (errs.size > 0) {
      setInvalidFields(errs);
      setTone("error");
      setMessage("Please fix the highlighted fields.");
      return;
    }

    setInvalidFields(new Set());

    const patch: Record<string, string> = {};
    if (trimmedMobile !== (employee.phone ?? "")) patch.mobile = trimmedMobile;
    if (trimmedEmail !== (employee.email ?? "")) patch.email = trimmedEmail;
    if (managerId.trim() !== (employee.reportingTo ?? ""))
      patch.managerId = managerId.trim();
    if (payStructureId.trim() !== "")
      patch.payStructureId = payStructureId.trim();

    if (Object.keys(patch).length === 0) {
      setTone("error");
      setMessage("No changes detected. Update a field before saving.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
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
        throw new Error(detail || `Update failed (${res.status})`);
      }

      setTone("success");
      setMessage("Employee updated successfully. Redirecting…");
      setTimeout(() => {
        router.push(`/hr/employees/${employee.id}`);
        router.refresh();
      }, 1200);
    } catch (err) {
      setTone("error");
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
      aria-label="Edit employee"
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>Contact &amp; Assignment</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Only the fields below can be updated. For structural changes (name,
          department, designation) contact HR administration.
        </p>
      </div>

      <div className="pad" style={{ display: "grid", gap: 20 }}>
        {/* Status region */}
        <div aria-live="polite" aria-atomic="true" id={ids.status}>
          {message && (
            <p
              role={tone === "error" ? "alert" : "status"}
              style={{
                margin: 0,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                background: tone === "success" ? "#dcfce7" : "#fee2e2",
                border: `1px solid ${tone === "success" ? "#86efac" : "#fca5a5"}`,
                color: tone === "success" ? "#166534" : "#b91c1c",
              }}
            >
              {tone === "success" ? "✅" : "⚠️"} {message}
            </p>
          )}
        </div>

        {/* Read-only summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            background: "#f8fafc",
            border: "1px solid var(--line, #cbd5e1)",
          }}
        >
          {[
            { label: "Employee ID", value: employee.employeeId },
            { label: "Department", value: employee.department },
            { label: "Designation", value: employee.designation },
            { label: "Status", value: employee.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, color: "#0f172a", fontWeight: 500 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Editable fields */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.mobile} style={labelStyle}>
              Mobile
            </label>
            <input
              id={ids.mobile}
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              aria-invalid={invalidFields.has("mobile")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("mobile")
                  ? "#ef4444"
                  : "var(--line, #cbd5e1)",
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.email} style={labelStyle}>
              Email
            </label>
            <input
              id={ids.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="employee@example.gov.in"
              autoComplete="email"
              aria-invalid={invalidFields.has("email")}
              style={{
                ...inputStyle,
                borderColor: invalidFields.has("email")
                  ? "#ef4444"
                  : "var(--line, #cbd5e1)",
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.managerId} style={labelStyle}>
              Manager ID
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 400,
                  color: "#64748b",
                }}
              >
                (UUID)
              </span>
            </label>
            <input
              id={ids.managerId}
              type="text"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              placeholder="Manager employee UUID"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.payStructureId} style={labelStyle}>
              Pay Structure ID
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 400,
                  color: "#64748b",
                }}
              >
                (UUID)
              </span>
            </label>
            <input
              id={ids.payStructureId}
              type="text"
              value={payStructureId}
              onChange={(e) => setPayStructureId(e.target.value)}
              placeholder="Pay structure UUID"
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
            {busy ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => router.push(`/hr/employees/${employee.id}`)}
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
