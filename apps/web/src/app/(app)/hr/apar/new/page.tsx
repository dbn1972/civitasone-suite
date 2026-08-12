"use client";
import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

export default function AparNewPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const empId    = useId();
  const periodId = useId();
  const roId     = useId();
  const rvId     = useId();
  const aaId     = useId();

  const [employeeId, setEmployeeId]               = useState("");
  const [appraisalPeriod, setAppraisalPeriod]     = useState("");
  const [reportingOfficerId, setReportingOfficerId] = useState("");
  const [reviewingOfficerId, setReviewingOfficerId] = useState("");
  const [acceptingAuthorityId, setAcceptingAuthorityId] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/proxy/v1/hrms/apar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, appraisalPeriod, reportingOfficerId, reviewingOfficerId, acceptingAuthorityId }),
      });
      const data = await res.json() as { id?: string; message?: string };
      if (!res.ok) {
        setMsg(data.message ?? `Error ${res.status}`);
        setStatus("error");
        return;
      }
      setStatus("done");
      router.push(`/hr/apar/${data.id}`);
    } catch {
      setMsg("Network error — please retry.");
      setStatus("error");
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
    borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
  };

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Initiate APAR" subtitle="Start a new Annual Performance Appraisal for an employee." back="/hr/apar" />

      <div className="card" style={{ maxWidth: 600, marginTop: 20 }}>
        <div className="card-h"><h3>APAR Details</h3></div>
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={empId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Employee ID (UUID)</label>
            <input id={empId} style={inp} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000" required pattern="[0-9a-f-]{36}" />
          </div>
          <div>
            <label htmlFor={periodId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Appraisal Period</label>
            <input id={periodId} style={inp} value={appraisalPeriod} onChange={(e) => setAppraisalPeriod(e.target.value)}
              placeholder="e.g. 2025-26" required maxLength={16} />
          </div>
          <div>
            <label htmlFor={roId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Reporting Officer ID (UUID)</label>
            <input id={roId} style={inp} value={reportingOfficerId} onChange={(e) => setReportingOfficerId(e.target.value)}
              placeholder="UUID of Reporting Officer" required pattern="[0-9a-f-]{36}" />
          </div>
          <div>
            <label htmlFor={rvId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Reviewing Officer ID (UUID)</label>
            <input id={rvId} style={inp} value={reviewingOfficerId} onChange={(e) => setReviewingOfficerId(e.target.value)}
              placeholder="UUID of Reviewing Officer" required pattern="[0-9a-f-]{36}" />
          </div>
          <div>
            <label htmlFor={aaId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Accepting Authority ID (UUID)</label>
            <input id={aaId} style={inp} value={acceptingAuthorityId} onChange={(e) => setAcceptingAuthorityId(e.target.value)}
              placeholder="UUID of Accepting Authority" required pattern="[0-9a-f-]{36}" />
          </div>
          {msg && (
            <p style={{ color: status === "error" ? "var(--red, #c00)" : "var(--green, #0a0)", fontSize: 13 }}>
              {msg}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => router.push("/hr/apar")}>Cancel</button>
            <button type="submit" className="btn primary" disabled={status === "submitting"}>
              {status === "submitting" ? "Initiating…" : "Initiate APAR"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
