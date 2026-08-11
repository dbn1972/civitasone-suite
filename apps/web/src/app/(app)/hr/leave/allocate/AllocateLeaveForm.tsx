"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

type EmployeeOption = { id: string; name: string; employeeNo: string };
type LeaveTypeOption = { id: string; code: string; name: string };

const CURRENT_FY = "2026-27";

export function AllocateLeaveForm() {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fy, setFy] = useState(CURRENT_FY);
  const [totalDays, setTotalDays] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const empId = useId();
  const ltId = useId();
  const fyId = useId();
  const daysId = useId();

  useEffect(() => {
    Promise.all([
      fetch("/api/proxy/v1/hrms/employees?limit=500").then((r) => r.json()),
      fetch("/api/proxy/v1/hrms/leave-types").then((r) => r.json()),
    ])
      .then(([empBody, ltBody]) => {
        const empRows: { id: string; name: string; employeeNo: string }[] =
          Array.isArray(empBody) ? empBody : empBody.data ?? [];
        const ltRows: { id: string; code: string; name: string }[] =
          Array.isArray(ltBody) ? ltBody : ltBody.data ?? [];
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const days = parseInt(totalDays, 10);
    if (!employeeId || !leaveTypeId || !fy || !days || days <= 0) {
      setStatus("error");
      setMessage("All fields are required and days must be a positive integer.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(fy)) {
      setStatus("error");
      setMessage("Financial year must be in YYYY-YY format (e.g. 2026-27).");
      return;
    }
    setStatus("submitting");
    setMessage("");
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
      setStatus("success");
      setMessage("Leave allocated successfully.");
      setTotalDays("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      style={{ maxWidth: 560 }}
    >
      <div>
        <label htmlFor={empId} className="block text-sm font-medium text-slate-700 mb-1">
          Employee <span aria-hidden style={{ color: "#b91c1c" }}>*</span>
        </label>
        <select id={empId} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls} required>
          {employees.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employeeNo})
              </option>
            ))
          )}
        </select>
      </div>

      <div>
        <label htmlFor={ltId} className="block text-sm font-medium text-slate-700 mb-1">
          Leave Type <span aria-hidden style={{ color: "#b91c1c" }}>*</span>
        </label>
        <select id={ltId} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={inputCls} required>
          {leaveTypes.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name} ({lt.code})
              </option>
            ))
          )}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={fyId} className="block text-sm font-medium text-slate-700 mb-1">
            Financial Year <span aria-hidden style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id={fyId}
            type="text"
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            placeholder="2026-27"
            maxLength={7}
            pattern="\d{4}-\d{2}"
            className={inputCls}
            required
          />
          <p className="mt-1 text-xs text-slate-500">Format: YYYY-YY</p>
        </div>
        <div>
          <label htmlFor={daysId} className="block text-sm font-medium text-slate-700 mb-1">
            Total Days <span aria-hidden style={{ color: "#b91c1c" }}>*</span>
          </label>
          <input
            id={daysId}
            type="number"
            min={1}
            max={365}
            value={totalDays}
            onChange={(e) => setTotalDays(e.target.value)}
            placeholder="e.g. 15"
            className={inputCls}
            required
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="submit"
          disabled={status === "submitting" || employees.length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {status === "submitting" ? "Allocating…" : "Allocate Leave"}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => router.push("/hr/leave")}
        >
          Cancel
        </button>
      </div>

      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm font-medium ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {status === "error" ? "Error: " : ""}{message}
        </p>
      )}
    </form>
  );
}
