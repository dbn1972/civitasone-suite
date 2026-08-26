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

  // Statutory & financial fields
  const [bankAccountNo, setBankAccountNo] = useState((employee as Record<string,unknown>).bankAccountNo as string ?? "");
  const [bankIfsc, setBankIfsc] = useState((employee as Record<string,unknown>).bankIfsc as string ?? "");
  const [uanNumber, setUanNumber] = useState((employee as Record<string,unknown>).uanNumber as string ?? "");
  const [esicIpNumber, setEsicIpNumber] = useState((employee as Record<string,unknown>).esicIpNumber as string ?? "");
  const [pran, setPran] = useState((employee as Record<string,unknown>).pran as string ?? "");

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
    bankAccountNo: `${formId}-bankAccountNo`,
    bankIfsc: `${formId}-bankIfsc`,
    uanNumber: `${formId}-uanNumber`,
    esicIpNumber: `${formId}-esicIpNumber`,
    pran: `${formId}-pran`,
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
    if (bankAccountNo.trim()) patch.bankAccountNo = bankAccountNo.trim();
    if (bankIfsc.trim()) patch.bankIfsc = bankIfsc.trim().toUpperCase();
    if (uanNumber.trim()) patch.uanNumber = uanNumber.trim();
    if (esicIpNumber.trim()) patch.esicIpNumber = esicIpNumber.trim();
    if (pran.trim()) patch.pran = pran.trim();

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

      // PATCH /v1/hrms/employees/:id returns 202 (queued command) -- the
      // update is being applied, not already confirmed done.
      setTone("success");
      setMessage("Update submitted. Redirecting…");
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


        {/* Statutory & Financial Details */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--ink1)" }}>
            Statutory &amp; Financial Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankAccountNo} style={labelStyle}>Bank Account No.</label>
              <input id={ids.bankAccountNo} type="text" value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                placeholder="e.g. 0012345678901"
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.bankIfsc} style={labelStyle}>Bank IFSC Code</label>
              <input id={ids.bankIfsc} type="text" value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value)}
                placeholder="e.g. SBIN0001234" maxLength={11}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.uanNumber} style={labelStyle}>EPFO UAN Number</label>
              <input id={ids.uanNumber} type="text" value={uanNumber}
                onChange={(e) => setUanNumber(e.target.value)}
                placeholder="12-digit UAN" maxLength={12}
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.esicIpNumber} style={labelStyle}>ESIC IP Number</label>
              <input id={ids.esicIpNumber} type="text" value={esicIpNumber}
                onChange={(e) => setEsicIpNumber(e.target.value)}
                placeholder="Employee ESIC insurance number"
                style={inputStyle} autoComplete="off" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.pran} style={labelStyle}>PRAN (NPS Account)</label>
              <input id={ids.pran} type="text" value={pran}
                onChange={(e) => setPran(e.target.value)}
                placeholder="12-digit PRAN" maxLength={12}
                style={inputStyle} autoComplete="off" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink3)", marginTop: 12 }}>
            Bank account and IFSC are required for salary disbursement. UAN is required for EPFO credit.
          </p>
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
