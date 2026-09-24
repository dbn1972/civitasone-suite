"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { PageHeader, Card, Button } from "../../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../../_components/DataSourceBadge";
import { useFormError } from "@/lib/useFormError";

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
  skills?: string[];
  source: string;
  stage: string;
  screeningDecision: string;
  appliedAt: string;
};

type Department = { id: string; name: string };
type Designation = { id: string; name: string };

export default function ApplicationDetailPage() {
  const t = useTranslations("recruitmentApplicationDetail");
  const { id: jobOpeningId, appId } = useParams<{ id: string; appId: string }>();
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [employeeType, setEmployeeType] = useState<"permanent" | "temporary" | "contract" | "deputation">("permanent");
  const [hireStatus, setHireStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [hireMessage, setHireMessage] = useState("");
  const formError = useFormError("application");

  const empNoId = useId();
  const dojId = useId();
  const basicId = useId();
  const deptId = useId();
  const desigId = useId();
  const typeId = useId();
  const hireDialogDescId = useId();

  useEffect(() => {
    async function load() {
      try {
        // There is no GET /v1/hrms/applications/:id route (confirmed 404 against
        // the live gateway) — only GET /v1/hrms/job-openings/:id/applications
        // (a list) exists. Fetch the pipeline for this vacancy and find the one
        // application we need, mirroring the same list-and-find pattern the
        // parent job-opening page already uses for its own missing singular GET.
        const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/applications`);
        if (!res.ok) {
          setSource("error");
          setError((await formError.fromResponse(res, "load")).message);
          return;
        }
        const data = await res.json() as { data?: Application[] };
        const found = (data.data ?? []).find((a) => a.id === appId) ?? null;
        if (!found) {
          setError(t("notFoundMessage"));
          return;
        }
        setApplication(found);
      } catch {
        setSource("error");
        setError(formError.fromException("load").message);
      } finally {
        setLoading(false);
      }
    }
    if (appId && jobOpeningId) load();
  }, [appId, jobOpeningId]);

  // UX: replaces the raw departmentId/designationId UUID text boxes in the
  // hire dialog below with searchable name-based dropdowns, matching the
  // pattern already used by PromoteWithApproval/TransferWithApproval.
  // Fetched only once the dialog is actually opened.
  useEffect(() => {
    if (!showHireDialog) return;
    void (async () => {
      try {
        const [deptRes, desigRes] = await Promise.all([
          fetch("/api/proxy/v1/hrms/departments?limit=200"),
          fetch("/api/proxy/v1/hrms/designations?limit=200"),
        ]);
        if (deptRes.ok) {
          const body = (await deptRes.json()) as { data?: Department[] } | Department[];
          setDepartments(Array.isArray(body) ? body : (body.data ?? []));
        }
        if (desigRes.ok) {
          const body = (await desigRes.json()) as { data?: Designation[] } | Designation[];
          setDesignations(Array.isArray(body) ? body : (body.data ?? []));
        }
      } catch { /* graceful fallback to raw-UUID inputs below */ }
    })();
  }, [showHireDialog]);

  // Focus-trap: lock Tab inside the hire dialog while open; Escape closes.
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showHireDialog) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    const timer = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>("input, select, button, textarea");
      first?.focus();
    }, 0);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowHireDialog(false);
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [showHireDialog]);

  async function handleHire(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeNo.trim() || !dateOfJoining || !departmentId.trim() || !designationId.trim()) {
      setHireStatus("error");
      setHireMessage(t("allFieldsRequired"));
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
        const resolved = await formError.fromResponse(res, "save");
        setHireStatus("error");
        setHireMessage(resolved.message);
        return;
      }
      setHireStatus("success");
      setHireMessage(t("hireSuccessMessage"));
      setApplication((prev) => prev ? { ...prev, stage: "hired" } : prev);
      setShowHireDialog(false);
    } catch {
      setHireStatus("error");
      setHireMessage(formError.fromException("save").message);
    }
  }

  if (loading) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "48px 0" }}>{t("loading")}</p>
      </main>
    );
  }

  if (error || !application) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} subtitle={t("notFoundSubtitle")} back={`/hr/recruitment/${jobOpeningId}`} backLabel="Back to Applications" />
        <DataSourceBadge source={source} />
        <Card padding>
          <p style={{ color: "var(--mut)", textAlign: "center" }}>{error ?? t("notFoundMessage")}</p>
        </Card>
      </main>
    );
  }

  const canHire = application.stage === "selected" || application.stage === "offered";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={application.applicantName}
        subtitle={t("subtitle")}
        back={`/hr/recruitment/${jobOpeningId}`} backLabel="Back to Applications"
        actions={
          canHire && hireStatus !== "success" ? (
            <Button onClick={() => setShowHireDialog(true)}>
              {t("hire")}
            </Button>
          ) : undefined
        }
      />
      <DataSourceBadge source={source} />

      {hireStatus === "success" && (
        <p role="status" aria-live="polite" className="pill good" style={{ marginBottom: 12 }}>
          {hireMessage}
        </p>
      )}

      <Card title={t("summaryTitle")}>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("applicationId")}</span><code style={{ fontSize: 12 }}>{application.id}</code></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("stage")}</span><span style={{ textTransform: "capitalize" }}>{application.stage}</span></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("screeningDecision")}</span><span style={{ textTransform: "capitalize" }}>{application.screeningDecision}</span></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("source")}</span>{application.source}</div>
          {application.email && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("email")}</span>{application.email}</div>}
          {application.qualification && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("qualification")}</span>{application.qualification}</div>}
          {application.experienceYears != null && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("experience")}</span>{t("experienceYears", { count: application.experienceYears })}</div>}
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("applied")}</span>{application.appliedAt}</div>
        </div>
      </Card>

      {showHireDialog && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}
          role="alertdialog" aria-modal="true" aria-labelledby="hire-dialog-title" aria-describedby={hireDialogDescId}
        >
          <div ref={dialogRef} style={{ background: "var(--bg)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", width: "100%", maxWidth: 520, padding: 28, margin: "0 16px" }}>
            <h2 id="hire-dialog-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              {t("hireDialogTitle", { name: application.applicantName })}
            </h2>
            <p id={hireDialogDescId} style={{ fontSize: 13, color: "var(--mut)", marginBottom: 8 }}>
              {t("hireDialogDescription", { name: application.applicantName })}
            </p>
            <form onSubmit={handleHire} style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor={empNoId} style={{ fontSize: 13, fontWeight: 500 }}>{t("employeeNo")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                <input id={empNoId} type="text" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder={t("employeeNoPlaceholder")} maxLength={32} style={inputStyle} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor={dojId} style={{ fontSize: 13, fontWeight: 500 }}>{t("dateOfJoining")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  <input id={dojId} type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} style={inputStyle} required />
                </div>
                <div>
                  <label htmlFor={basicId} style={{ fontSize: 13, fontWeight: 500 }}>{t("basicPay")}</label>
                  <input id={basicId} type="number" min={0} value={basicMinor} onChange={(e) => setBasicMinor(Number(e.target.value))} placeholder={t("basicPayPlaceholder")} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor={deptId} style={{ fontSize: 13, fontWeight: 500 }}>{t("departmentId")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  {departments.length > 0 ? (
                    <select id={deptId} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={inputStyle} required>
                      <option value="">Select department…</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input id={deptId} type="text" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder={t("uuidPlaceholder")} style={inputStyle} required />
                  )}
                </div>
                <div>
                  <label htmlFor={desigId} style={{ fontSize: 13, fontWeight: 500 }}>{t("designationId")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  {designations.length > 0 ? (
                    <select id={desigId} value={designationId} onChange={(e) => setDesignationId(e.target.value)} style={inputStyle} required>
                      <option value="">Select designation…</option>
                      {designations.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input id={desigId} type="text" value={designationId} onChange={(e) => setDesignationId(e.target.value)} placeholder={t("uuidPlaceholder")} style={inputStyle} required />
                  )}
                </div>
              </div>
              <div>
                <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 500 }}>{t("employeeType")}</label>
                <select id={typeId} value={employeeType} onChange={(e) => setEmployeeType(e.target.value as typeof employeeType)} style={inputStyle}>
                  <option value="permanent">{t("typePermanent")}</option>
                  <option value="temporary">{t("typeTemporary")}</option>
                  <option value="contract">{t("typeContract")}</option>
                  <option value="deputation">{t("typeDeputation")}</option>
                </select>
              </div>

              {hireStatus === "error" && hireMessage && (
                <p role="alert" className="pill bad">{hireMessage}</p>
              )}

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4 }}>
                <Button variant="ghost" onClick={() => setShowHireDialog(false)}>{t("cancel")}</Button>
                <Button type="submit" disabled={hireStatus === "submitting"} loading={hireStatus === "submitting"} style={{ minWidth: 140 }}>
                  {hireStatus === "submitting" ? t("processing") : t("confirmHire")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
