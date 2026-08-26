"use client";

import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

type EmployeeOption = { id: string; name: string; employeeNo: string };
type LeaveTypeOption = { id: string; code: string; name: string };

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid #ef4444" };
const fieldErrStyle: CSSProperties = { color: "#b91c1c", fontSize: 12, margin: "3px 0 0" };

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}

export function AllocateLeaveForm() {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fy, setFy] = useState(getCurrentFY);
  const [totalDays, setTotalDays] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const empId = useId();
  const ltId = useId();
  const fyId = useId();
  const daysId = useId();

  useEffect(() => {
    Promise.all([
      fetch("/api/proxy/v1/hrms/employees?limit=500").then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch("/api/proxy/v1/hrms/leave-types").then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ])
      .then(([empBody, ltBody]) => {
        const empRows: EmployeeOption[] = Array.isArray(empBody) ? empBody : (empBody.data ?? []);
        const ltRows: LeaveTypeOption[] = Array.isArray(ltBody) ? ltBody : (ltBody.data ?? []);
        setEmployees(empRows);
        setLeaveTypes(ltRows);
        if (empRows[0]) setEmployeeId(empRows[0].id);
        if (ltRows[0]) setLeaveTypeId(ltRows[0].id);
      })
      .catch(() => {
        setStatus("error");
        setMessage("Failed to load employees or leave types.");
      });
  }, []);

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!employeeId) errs.add("employee");
    if (!leaveTypeId) errs.add("leaveType");
    if (!fy || !/^\d{4}-\d{2}$/.test(fy)) errs.add("fy");
    const days = parseInt(totalDays, 10);
    if (!totalDays || isNaN(days) || days <= 0 || days > 365) errs.add("days");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setStatus("submitting");
    setMessage("");
    const days = parseInt(totalDays, 10);
    try {
      const res = await fetch("/api/proxy/v1/hrms/leave-allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, leaveTypeId, fy, totalDays: days }),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      // POST /v1/hrms/leave-allocations returns 202 (queued command), not a
      // completed allocation — say so honestly rather than claiming it's done.
      setStatus("success");
      setMessage("Leave allocation submitted. The employee's balance will update shortly.");
      setTotalDays("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 14 }}>
      {message && (
        <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"}
          className={`pill ${status === "error" ? "bad" : "good"}`} style={{ margin: 0 }}>
          {message}
        </p>
      )}

      <div>
        <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 500 }}>
          Employee <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          id={empId}
          value={employeeId}
          onChange={(e) => { setEmployeeId(e.target.value); clearErr("employee"); }}
          style={invalid.has("employee") ? inputErrStyle : inputStyle}
          aria-invalid={invalid.has("employee")}
          aria-describedby={invalid.has("employee") ? `${empId}-err` : undefined}
        >
          {employees.length === 0
            ? <option value="">Loading…</option>
            : employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
              ))}
        </select>
        {invalid.has("employee") && (
          <p id={`${empId}-err`} role="alert" style={fieldErrStyle}>Please select an employee.</p>
        )}
      </div>

      <div>
        <label htmlFor={ltId} style={{ fontSize: 13, fontWeight: 500 }}>
          Leave Type <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          id={ltId}
          value={leaveTypeId}
          onChange={(e) => { setLeaveTypeId(e.target.value); clearErr("leaveType"); }}
          style={invalid.has("leaveType") ? inputErrStyle : inputStyle}
          aria-invalid={invalid.has("leaveType")}
          aria-describedby={invalid.has("leaveType") ? `${ltId}-err` : undefined}
        >
          {leaveTypes.length === 0
            ? <option value="">Loading…</option>
            : leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>
              ))}
        </select>
        {invalid.has("leaveType") && (
          <p id={`${ltId}-err`} role="alert" style={fieldErrStyle}>Please select a leave type.</p>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 500 }}>
            Financial Year <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            id={fyId}
            type="text"
            value={fy}
            onChange={(e) => { setFy(e.target.value); clearErr("fy"); }}
            placeholder={getCurrentFY()}
            maxLength={7}
            style={invalid.has("fy") ? inputErrStyle : inputStyle}
            aria-invalid={invalid.has("fy")}
            aria-describedby={invalid.has("fy") ? `${fyId}-err` : `${fyId}-hint`}
          />
          {invalid.has("fy") ? (
            <p id={`${fyId}-err`} role="alert" style={fieldErrStyle}>Must be YYYY-YY format (e.g. {getCurrentFY()}).</p>
          ) : (
            <p id={`${fyId}-hint`} style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>Format: YYYY-YY</p>
          )}
        </div>
        <div>
          <label htmlFor={daysId} style={{ fontSize: 13, fontWeight: 500 }}>
            Total Days <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            id={daysId}
            type="number"
            min={1}
            max={365}
            value={totalDays}
            onChange={(e) => { setTotalDays(e.target.value); clearErr("days"); }}
            placeholder="e.g. 15"
            style={invalid.has("days") ? inputErrStyle : inputStyle}
            aria-invalid={invalid.has("days")}
            aria-describedby={invalid.has("days") ? `${daysId}-err` : undefined}
          />
          {invalid.has("days") && (
            <p id={`${daysId}-err`} role="alert" style={fieldErrStyle}>Enter a number between 1 and 365.</p>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button type="submit" className="btn primary" disabled={status === "submitting" || employees.length === 0} style={{ minHeight: 44, minWidth: 140 }}>
          {status === "submitting" ? "Allocating…" : "Allocate Leave"}
        </button>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => router.push("/hr/leave")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
