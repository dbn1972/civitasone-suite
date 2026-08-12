"use client";

import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "../../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../../_components/DataSourceBadge";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};

type Application = {
  id: string;
  applicantName: string;
  email?: string;
  mobile?: string;
  qualification?: string;
  experienceYears?: number;
  source: string;
  stage: string;
  status: string;
  jobOpeningId: string;
  appliedAt: string;
};

export default function ApplicationDetailPage() {
  const { appId } = useParams<{ id: string; appId: string }>();
  const router = useRouter();

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "error">("api");

  const [showHireDialog, setShowHireDialog] = useState(false);
  const [employeeNo, setEmployeeNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [basicMinor, setBasicMinor] = useState(0);
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [employeeType, setEmployeeType] = useState<"permanent" | "temporary" | "contract" | "deputation">("permanent");
  const [hireStatus, setHireStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [hireMessage, setHireMessage] = useState("");

  const empNoId = useId();
  const dojId = useId();
  const basicId = useId();
  const deptId = useId();
  const desigId = useId();
  const typeId = useId();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/applications/${appId}`);
        if (!res.ok) {
          setSource("error");
          setError(res.status === 404 ? "Application not found." : `Failed to load (${res.status})`);
          return;
        }
        const data = await res.json() as { payload?: Application } & Application;
        setApplication(data.payload ?? data);
      } catch {
        setSource("error");
        setError("Network error loading application.");
      } finally {
        setLoading(false);
      }
    }
    if (appId) load();
  }, [appId]);

  async function handleHire(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeNo.trim() || !dateOfJoining || !departmentId.trim() || !designationId.trim()) {
      setHireStatus("error");
      setHireMessage("All fields are required.");
      return;
    }
    setHireStatus("submitting");
    setHireMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/hire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeNo: employeeNo.trim(), dateOfJoining, basicMinor, departmentId: departmentId.trim(), designationId: designationId.trim(), employeeType }),
      });
      if (!res.ok) {
        const text = await res.text();
        setHireStatus("error");
        setHireMessage(text || `Request failed (${res.status})`);
        return;
      }
      setHireStatus("success");
      setHireMessage("Hire initiated. Employee record is being created.");
      setShowHireDialog(false);
      router.refresh();
    } catch (err) {
      setHireStatus("error");
      setHireMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  if (loading) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "48px 0" }}>Loading application…</p>
      </main>
    );
  }

  if (error || !application) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Application" subtitle="Not found" back=".." />
        <DataSourceBadge source={source} />
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--mut)" }}>{error ?? "Application not found."}</p>
        </div>
      </main>
    );
  }

  const canHire = application.stage === "selected" || application.stage === "offered";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={application.applicantName}
        subtitle="Application detail"
        back="."
        actions={
          canHire ? (
            <button onClick={() => setShowHireDialog(true)} className="btn primary">
              Hire
            </button>
          ) : undefined
        }
      />
      <DataSourceBadge source={source} />

      {hireStatus === "success" && (
        <p role="status" aria-live="polite" className="pill good" style={{ marginBottom: 12 }}>
          {hireMessage}
        </p>
      )}

      <div className="card">
        <div className="card-h"><h3>Application Summary</h3></div>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Application ID</span><code style={{ fontSize: 12 }}>{application.id}</code></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Stage</span><span style={{ textTransform: "capitalize" }}>{application.stage}</span></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Status</span><span style={{ textTransform: "capitalize" }}>{application.status}</span></div>
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Source</span>{application.source}</div>
          {application.email && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Email</span>{application.email}</div>}
          {application.qualification && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Qualification</span>{application.qualification}</div>}
          {application.experienceYears != null && <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Experience</span>{application.experienceYears} yr{application.experienceYears !== 1 ? "s" : ""}</div>}
          <div><span style={{ color: "var(--mut)", marginRight: 8 }}>Applied</span>{application.appliedAt}</div>
        </div>
      </div>

      {showHireDialog && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}
          role="dialog" aria-modal="true" aria-labelledby="hire-dialog-title"
        >
          <div style={{ background: "var(--bg)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", width: "100%", maxWidth: 520, padding: 28, margin: "0 16px" }}>
            <h2 id="hire-dialog-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              Hire — {application.applicantName}
            </h2>
            <form onSubmit={handleHire} style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor={empNoId} style={{ fontSize: 13, fontWeight: 500 }}>Employee No <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span></label>
                <input id={empNoId} type="text" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="e.g. EMP-2025-001" maxLength={32} style={inputStyle} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor={dojId} style={{ fontSize: 13, fontWeight: 500 }}>Date of Joining <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span></label>
                  <input id={dojId} type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} style={inputStyle} required />
                </div>
                <div>
                  <label htmlFor={basicId} style={{ fontSize: 13, fontWeight: 500 }}>Basic Pay (₹)</label>
                  <input id={basicId} type="number" min={0} value={basicMinor} onChange={(e) => setBasicMinor(Number(e.target.value))} placeholder="in paise" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor={deptId} style={{ fontSize: 13, fontWeight: 500 }}>Department ID <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span></label>
                  <input id={deptId} type="text" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="UUID" style={inputStyle} required />
                </div>
                <div>
                  <label htmlFor={desigId} style={{ fontSize: 13, fontWeight: 500 }}>Designation ID <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span></label>
                  <input id={desigId} type="text" value={designationId} onChange={(e) => setDesignationId(e.target.value)} placeholder="UUID" style={inputStyle} required />
                </div>
              </div>
              <div>
                <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 500 }}>Employee Type</label>
                <select id={typeId} value={employeeType} onChange={(e) => setEmployeeType(e.target.value as typeof employeeType)} style={inputStyle}>
                  <option value="permanent">Permanent</option>
                  <option value="temporary">Temporary</option>
                  <option value="contract">Contract</option>
                  <option value="deputation">Deputation</option>
                </select>
              </div>

              {hireStatus === "error" && hireMessage && (
                <p role="alert" className="pill bad">{hireMessage}</p>
              )}

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" className="btn ghost" onClick={() => setShowHireDialog(false)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={hireStatus === "submitting"} style={{ minWidth: 140 }}>
                  {hireStatus === "submitting" ? "Processing…" : "Confirm Hire"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
