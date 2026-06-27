"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

export function CreateProjectForm() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sanctionedRupees, setSanctionedRupees] = useState("");
  const [dprCostRupees, setDprCostRupees] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);

  function validate(): string | null {
    if (!code.trim()) {
      setInvalidField("code");
      return "Project code is required.";
    }
    if (code.trim().length > 64) {
      setInvalidField("code");
      return "Project code must be 64 characters or fewer.";
    }
    if (!projectName.trim()) {
      setInvalidField("projectName");
      return "Project name is required.";
    }
    if (startDate && endDate && endDate < startDate) {
      setInvalidField("endDate");
      return "End date must be on or after start date.";
    }
    if (sanctionedRupees && (isNaN(Number(sanctionedRupees)) || Number(sanctionedRupees) < 0)) {
      setInvalidField("sanctionedRupees");
      return "Sanctioned amount must be a non-negative number.";
    }
    if (dprCostRupees && (isNaN(Number(dprCostRupees)) || Number(dprCostRupees) < 0)) {
      setInvalidField("dprCostRupees");
      return "DPR cost must be a non-negative number.";
    }
    setInvalidField(null);
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
      code: code.trim(),
      name: projectName.trim(),
    };
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    if (sanctionedRupees) body.sanctionedMinor = Math.round(Number(sanctionedRupees) * 100);
    if (dprCostRupees) body.dprCostMinor = Math.round(Number(dprCostRupees) * 100);

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
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="code">Project code *</label>
            <input
              id="code"
              className="inp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              aria-required="true"
              aria-invalid={invalidField === "code"}
              maxLength={64}
              style={{ minHeight: 44 }}
              placeholder="e.g. PRJ-2024-001"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="projectName">Project name *</label>
            <input
              id="projectName"
              className="inp"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              aria-required="true"
              aria-invalid={invalidField === "projectName"}
              style={{ minHeight: 44 }}
              placeholder="e.g. NH-48 Widening Phase II"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="startDate">Start date</label>
            <input
              id="startDate"
              type="date"
              className="inp"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="endDate">End date</label>
            <input
              id="endDate"
              type="date"
              className="inp"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={invalidField === "endDate"}
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="sanctionedRupees">Sanctioned amount (₹)</label>
            <input
              id="sanctionedRupees"
              type="number"
              min="0"
              step="0.01"
              className="inp"
              value={sanctionedRupees}
              onChange={(e) => setSanctionedRupees(e.target.value)}
              aria-invalid={invalidField === "sanctionedRupees"}
              style={{ minHeight: 44 }}
              placeholder="e.g. 5000000"
            />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="dprCostRupees">DPR cost (₹)</label>
            <input
              id="dprCostRupees"
              type="number"
              min="0"
              step="0.01"
              className="inp"
              value={dprCostRupees}
              onChange={(e) => setDprCostRupees(e.target.value)}
              aria-invalid={invalidField === "dprCostRupees"}
              style={{ minHeight: 44 }}
              placeholder="e.g. 250000"
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
