"use client";
import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export default function AparNewPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const formError = useFormError("APAR");

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
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/apar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, appraisalPeriod, reportingOfficerId, reviewingOfficerId, acceptingAuthorityId }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setMsg(resolved.message);
        setStatus("error");
        return;
      }
      const data = await res.json() as { id?: string };
      setStatus("done");
      router.push(`/hr/apar/${data.id}`);
    } catch {
      setMsg(formError.fromException("save").message);
      setStatus("error");
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Initiate APAR" subtitle="Start a new Annual Performance Appraisal for an employee." back="/hr/apar" />

      <div style={{ maxWidth: 600, marginTop: 20 }}>
      <Card title="APAR Details">
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={empId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Employee ID (UUID)</label>
            <input id={empId} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000" required pattern="[0-9a-f-]{36}" />
            {formError.fieldError("employeeId") && (
              <p style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{formError.fieldError("employeeId")}</p>
            )}
          </div>
          <div>
            <label htmlFor={periodId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Appraisal Period</label>
            <input id={periodId} value={appraisalPeriod} onChange={(e) => setAppraisalPeriod(e.target.value)}
              placeholder="e.g. 2025-26" required maxLength={16} />
          </div>
          <div>
            <label htmlFor={roId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Reporting Officer ID (UUID)</label>
            <input id={roId} value={reportingOfficerId} onChange={(e) => setReportingOfficerId(e.target.value)}
              placeholder="UUID of Reporting Officer" required pattern="[0-9a-f-]{36}" />
          </div>
          <div>
            <label htmlFor={rvId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Reviewing Officer ID (UUID)</label>
            <input id={rvId} value={reviewingOfficerId} onChange={(e) => setReviewingOfficerId(e.target.value)}
              placeholder="UUID of Reviewing Officer" required pattern="[0-9a-f-]{36}" />
          </div>
          <div>
            <label htmlFor={aaId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>Accepting Authority ID (UUID)</label>
            <input id={aaId} value={acceptingAuthorityId} onChange={(e) => setAcceptingAuthorityId(e.target.value)}
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
      </Card>
      </div>
    </main>
  );
}
