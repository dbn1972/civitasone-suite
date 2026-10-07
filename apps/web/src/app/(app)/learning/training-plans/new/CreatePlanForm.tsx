/**
 * GAP-LEARNING-TRAINING-PLANS-02: HR-only "create training plan" form. POSTs
 * JSON to the proxy; the backend returns 202 (async publish), so on success we
 * tell the user the plan is being created and send them back to the list
 * (which may lag until the consumer runs). The server also enforces HR_ROLES.
 */
"use client";

import { useState, useId, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/_components/ds";

type DeptOption = { id: string; name: string };

export function CreatePlanForm({ departments }: { departments: DeptOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [planYear, setPlanYear] = useState(String(new Date().getUTCFullYear()));
  const [departmentId, setDepartmentId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const idTitle = useId();
  const idYear = useId();
  const idDept = useId();
  const idRole = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const year = Number(planYear);
    if (!title.trim()) { setError("Enter a plan title."); setState("error"); return; }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) { setError("Enter a plan year between 2020 and 2100."); setState("error"); return; }
    setState("submitting");
    try {
      const res = await fetch("/api/proxy/v1/hrms/learning/training-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          planYear: year,
          ...(departmentId ? { departmentId } : {}),
          ...(roleCode.trim() ? { roleCode: roleCode.trim() } : {}),
        }),
      });
      if (res.ok) {
        setState("done");
        router.push("/learning/training-plans");
        router.refresh();
        return;
      }
      if (res.status === 403) setError("You are not authorised to create training plans.");
      else if (res.status === 400) setError("Please check the form values and try again.");
      else setError("Could not create the plan. Please try again.");
      setState("error");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Create training plan" style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 24px" }}>
      <div>
        <label htmlFor={idTitle} style={labelStyle}>Plan title <span aria-hidden>*</span></label>
        <input id={idTitle} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={256} style={inputStyle} />
      </div>
      <div>
        <label htmlFor={idYear} style={labelStyle}>Plan year <span aria-hidden>*</span></label>
        <input id={idYear} type="number" value={planYear} onChange={(e) => setPlanYear(e.target.value)} required min={2020} max={2100} style={{ ...inputStyle, maxWidth: 160 }} />
        <span style={{ display: "block", fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>Indian fiscal year starting in this calendar year (April–March).</span>
      </div>
      <div>
        <label htmlFor={idDept} style={labelStyle}>Department (optional)</label>
        {departments.length > 0 ? (
          <select id={idDept} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={inputStyle}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ) : (
          <input id={idDept} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="Department UUID (optional)" style={inputStyle} />
        )}
      </div>
      <div>
        <label htmlFor={idRole} style={labelStyle}>Role code (optional)</label>
        <input id={idRole} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} maxLength={64} placeholder="e.g. clerk" style={inputStyle} />
      </div>
      {state === "error" && error && (
        <p role="alert" style={{ fontSize: 13, color: "var(--red, #dc2626)", margin: 0 }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => router.push("/learning/training-plans")}>Cancel</Button>
        <Button type="submit" style={{ minHeight: 44 }} disabled={state === "submitting"} aria-busy={state === "submitting"}>
          {state === "submitting" ? "Creating…" : "Create plan"}
        </Button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--muted, #6b7280)", marginBottom: 5 };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44 };
