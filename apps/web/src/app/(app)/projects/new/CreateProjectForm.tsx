"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

export function CreateProjectForm() {
  const router = useRouter();

  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [department, setDepartment] = useState("");
  const [scheme, setScheme] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expectedEndDate, setExpectedEndDate] = useState("");
  const [totalBudgetRupees, setTotalBudgetRupees] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  function validate(): string | null {
    if (!projectName.trim()) return "Project name is required.";
    if (!startDate) return "Start date is required.";
    if (!expectedEndDate) return "Expected end date is required.";
    if (expectedEndDate < startDate) return "Expected end date must be on or after start date.";
    if (!totalBudgetRupees || isNaN(Number(totalBudgetRupees)) || Number(totalBudgetRupees) < 0)
      return "Total budget must be a non-negative number.";
    return null;
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setStatus("error");
      setMessage(err);
      return;
    }
    setStatus("idle");
    setMessage("");
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setStatus("submitting");
    setMessage("");

    const body: Record<string, unknown> = {
      name: projectName.trim(),
      startDate,
      expectedEndDate,
      totalBudget: Math.round(Number(totalBudgetRupees) * 100),
    };
    if (projectCode.trim()) body.projectCode = projectCode.trim();
    if (department.trim()) body.department = department.trim();
    if (scheme.trim()) body.scheme = scheme.trim();

    try {
      const res = await fetch("/api/proxy/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push("/projects/list");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => void handleFormSubmit(e)}
        className="card pad"
        style={{ maxWidth: 820 }}
        noValidate
        aria-busy={status === "submitting"}
      >
        <div className="fields">
          <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="projectName">Project name *</label>
            <input
              id="projectName"
              className="inp"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder="e.g. NH-48 Widening Phase II"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="projectCode">Project code</label>
            <input
              id="projectCode"
              className="inp"
              value={projectCode}
              onChange={(e) => setProjectCode(e.target.value)}
              style={{ minHeight: 44 }}
              placeholder="e.g. PRJ-2024-001"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="department">Department</label>
            <input
              id="department"
              className="inp"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{ minHeight: 44 }}
              placeholder="e.g. Public Works"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="scheme">Scheme</label>
            <input
              id="scheme"
              className="inp"
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
              style={{ minHeight: 44 }}
              placeholder="e.g. PMGSY"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="startDate">Start date *</label>
            <input
              id="startDate"
              type="date"
              className="inp"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="expectedEndDate">Expected end date *</label>
            <input
              id="expectedEndDate"
              type="date"
              className="inp"
              value={expectedEndDate}
              onChange={(e) => setExpectedEndDate(e.target.value)}
              required
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="totalBudgetRupees">Total budget (₹) *</label>
            <input
              id="totalBudgetRupees"
              type="number"
              min="0"
              step="0.01"
              className="inp"
              value={totalBudgetRupees}
              onChange={(e) => setTotalBudgetRupees(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder="e.g. 5000000"
            />
          </div>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p
              role={status === "error" ? "alert" : undefined}
              style={{
                marginTop: 12,
                color: status === "error" ? "#b91c1c" : "#047857",
                fontSize: "0.875rem",
              }}
            >
              {message}
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? "Saving…" : "Create project"}
          </button>
          <Link href="/projects/list" className="btn ghost" style={{ minHeight: 44 }}>
            Cancel
          </Link>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Create project"
        description="This will register the project in the system. Are you sure?"
        confirmLabel="Create project"
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
