"use client";

import { useId, useState } from "react";
import type { EmployeeDetail } from "@civitasone/types";

type EditableFields = {
  phone?: string;
  email?: string;
  reportingTo?: string;
  payStructureId?: string;
};

interface EditEmployeeFormProps {
  employee: EmployeeDetail;
  onCancel: () => void;
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

export function EditEmployeeForm({ employee, onCancel }: EditEmployeeFormProps) {
  const formId = useId();

  const [phone, setPhone] = useState(employee.phone ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  const [managerId, setManagerId] = useState(employee.reportingTo ?? "");
  // payStructureId is not on EmployeeDetail type (set via API only)
  const [payStructureId, setPayStructureId] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");

  const phoneId = `${formId}-phone`;
  const emailId = `${formId}-email`;
  const managerIdId = `${formId}-managerId`;
  const payStructureIdId = `${formId}-payStructureId`;
  const statusId = `${formId}-status`;

  function handleCancel() {
    // Reset fields to original values
    setPhone(employee.phone ?? "");
    setEmail(employee.email ?? "");
    setManagerId(employee.reportingTo ?? "");
    setPayStructureId("");
    setMessage(null);
    onCancel();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);

    // Build changed-fields-only patch
    const patch: EditableFields = {};
    if (phone.trim() !== (employee.phone ?? "")) patch.phone = phone.trim();
    if (email.trim() !== (employee.email ?? "")) patch.email = email.trim();
    if (managerId.trim() !== (employee.reportingTo ?? "")) patch.reportingTo = managerId.trim();
    if (payStructureId.trim() !== "") patch.payStructureId = payStructureId.trim();

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
          if (typeof json === "object" && json !== null && "message" in json) {
            detail = String((json as Record<string, unknown>).message);
          }
        } catch {
          // ignore
        }
        throw new Error(detail || `Update failed (${res.status})`);
      }

      setTone("success");
      setMessage("Employee profile updated successfully.");
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      aria-label="Edit employee profile"
      noValidate
      className="card"
      style={{ marginTop: 16 }}
    >
      <div className="card-h">
        <h3>Edit Employee</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Status region — aria-live polite */}
        <div aria-live="polite" aria-atomic="true" id={statusId}>
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

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {/* Mobile */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={phoneId} style={labelStyle}>
              Mobile
            </label>
            <input
              id={phoneId}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={emailId} style={labelStyle}>
              Email
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="employee@example.gov.in"
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          {/* Manager ID */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={managerIdId} style={labelStyle}>
              Manager ID
            </label>
            <input
              id={managerIdId}
              type="text"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              placeholder="e.g. EMP-0042"
              style={inputStyle}
            />
          </div>

          {/* Pay Structure ID */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={payStructureIdId} style={labelStyle}>
              Pay Structure ID
            </label>
            <input
              id={payStructureIdId}
              type="text"
              value={payStructureId}
              onChange={(e) => setPayStructureId(e.target.value)}
              placeholder="UUID of the pay structure"
              pattern="[0-9a-fA-F\-]{36}"
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
            style={{ minHeight: 44, minWidth: 120 }}
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleCancel}
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
