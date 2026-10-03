"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { PageHeader, Card, Button, ErrorState } from "../../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../../_components/DataSourceBadge";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { rupeesToMinorString } from "@/lib/money";
import { formatIndianDate, formatMoney, humanizeStatus } from "@/lib/formatters";
import {
  HIRE_POLL_INTERVAL_MS, HIRE_POLL_MAX_ATTEMPTS, fetchApplicationOnce, fetchNamedList, isHireConfirmed,
  type Application, type LookupState, type NamedOption,
} from "./applicationData";
import { ApplicationExtras } from "./ApplicationExtras";
import { ContactReveal } from "../../../_components/ContactReveal";
import { ApplicationFeeDialog } from "../../_components/ApplicationFeeDialog";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};

type HirePhase = "idle" | "pending" | "confirmed" | "stalled";

export default function ApplicationDetailPage() {
  const t = useTranslations("recruitmentApplicationDetail");
  const { id: jobOpeningId, appId } = useParams<{ id: string; appId: string }>();
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  // GAP-...-APPLICATION-07: a real "not found" and a fetch failure are different states.
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);

  const [showHireDialog, setShowHireDialog] = useState(false);
  const [showFee, setShowFee] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // GAP-RECRUITMENT-CAREERS-DETAIL-04: open the uploaded resume through the audited, short-lived link.
  const openResume = useCallback(async () => {
    setResumeError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${appId}/resume-link`);
      const j = res.ok ? (await res.json()) as { data?: { url?: string } } : null;
      if (!j?.data?.url || !/^https:\/\//i.test(j.data.url)) { setResumeError(t("resumeLinkFailed")); return; }
      window.open(j.data.url, "_blank", "noopener,noreferrer");
    } catch {
      setResumeError(t("resumeLinkFailed"));
    }
  }, [appId, t]);
  const [employeeNo, setEmployeeNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  // Entered in RUPEES (decimal string) and converted to paise only at submit via
  // rupeesToMinorString (string-based, no float) -- GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-01.
  // Defaults empty: the backend rejects 0 (hireApplicationBody.basicMinor is positive).
  const [basicRupees, setBasicRupees] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [departments, setDepartments] = useState<NamedOption[]>([]);
  const [designations, setDesignations] = useState<NamedOption[]>([]);
  const [deptState, setDeptState] = useState<LookupState>("loading");
  const [desigState, setDesigState] = useState<LookupState>("loading");
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [employeeType, setEmployeeType] = useState<"permanent" | "temporary" | "contract" | "deputation">("permanent");
  const [hireStatus, setHireStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [hireMessage, setHireMessage] = useState("");
  // GAP-...-APPLICATION-03: a 202 only means the hire command was QUEUED; the stage is shown from
  // server data and the page polls until the consumer has actually finished (or warns).
  const [hirePhase, setHirePhase] = useState<HirePhase>("idle");
  const formError = useFormError("application");

  const empNoId = useId();
  const dojId = useId();
  const basicId = useId();
  const deptId = useId();
  const desigId = useId();
  const typeId = useId();
  const hireDialogDescId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    const outcome = await fetchApplicationOnce(appId, jobOpeningId);
    if (outcome.kind === "ok") {
      setApplication(outcome.application);
    } else if (outcome.kind === "notfound") {
      setApplication(null);
      setNotFound(true);
    } else {
      setApplication(null);
      const resolved = outcome.response ? await formError.fromResponse(outcome.response, "load") : formError.fromException("load");
      setError({ message: resolved.message, forbidden: outcome.response?.status === 403 });
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [appId, jobOpeningId]);

  useEffect(() => {
    if (appId && jobOpeningId) void load();
  }, [appId, jobOpeningId, load]);

  // The hire dialog's department/designation are name-based selects (never free-text UUIDs: hire
  // requires valid ids). Fetched once the dialog opens; a failure is shown inline with a Retry.
  useEffect(() => {
    if (!showHireDialog) return;
    const controller = new AbortController();
    setDeptState("loading");
    setDesigState("loading");
    void (async () => {
      try {
        const [depts, desigs] = await Promise.all([
          fetchNamedList("/api/proxy/v1/hrms/departments?limit=200", controller.signal),
          fetchNamedList("/api/proxy/v1/hrms/designations?limit=200", controller.signal),
        ]);
        setDepartments(depts ?? []);
        setDeptState(depts ? "ready" : "error");
        setDesignations(desigs ?? []);
        setDesigState(desigs ? "ready" : "error");
      } catch {
        /* aborted: the dialog closed */
      }
    })();
    return () => controller.abort();
  }, [showHireDialog, lookupAttempt]);

  // Post-hire confirmation: refetch the application every few seconds and derive the stage from
  // server data; give up after HIRE_POLL_MAX_ATTEMPTS with a visible warning.
  useEffect(() => {
    if (hirePhase !== "pending") return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void (async () => {
        const outcome = await fetchApplicationOnce(appId, jobOpeningId);
        if (cancelled) return;
        if (outcome.kind === "ok") setApplication(outcome.application);
        if (outcome.kind === "ok" && isHireConfirmed(outcome.application)) {
          clearInterval(timer);
          setHirePhase("confirmed");
        } else if (attempts >= HIRE_POLL_MAX_ATTEMPTS) {
          clearInterval(timer);
          setHirePhase("stalled");
        }
      })();
    }, HIRE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hirePhase, appId, jobOpeningId]);

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
      if (focusable.length === 0) return; // ux-001-ok: DOM focus-trap over this dialog's own focusable elements (keyboard nav), not a data loader
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
    // MEDIUM finding: re-derived exactly from the backend's own rule
    // (hireApplicationBody.basicMinor = z.number().int().positive(), see
    // recruitment/validators.ts) rather than guessed -- must be a positive
    // integer, so empty/0/negative/fractional all fail here instead of
    // surfacing only as a server 400 after a round trip.
    const basicMinorStr = rupeesToMinorString(basicRupees);
    const basicMinor = basicMinorStr === null ? NaN : Number(basicMinorStr);
    if (!Number.isSafeInteger(basicMinor) || basicMinor <= 0) {
      setHireStatus("error");
      setHireMessage(t("basicPayRequired"));
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
      // 202 = queued, not done. Do NOT mark the application hired locally (the consumer can still reject
      // it: no vacancy left, department/designation gone); poll the server for the real stage.
      setHireStatus("success");
      setHireMessage(t("hireQueuedMessage"));
      setHirePhase("pending");
      setShowHireDialog(false);
    } catch {
      setHireStatus("error");
      setHireMessage(formError.fromException("save").message);
    }
  }

  if (loading) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <p style={{ textAlign: "center", color: "var(--mut)", padding: "48px 0" }}>{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    // A real failure: shared error state with a Retry that re-runs load() (a 403 is permanent, so no Retry).
    const human = toHumanError("load", { area: "application" });
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} subtitle={t("errorSubtitle")} back={`/hr/recruitment/${jobOpeningId}`} backLabel={t("backToApplications")} />
        <DataSourceBadge source="error" />
        <Card padding>
          <ErrorState
            error={{ what: error.message, next: human.next, actions: error.forbidden ? ["back", "help"] : human.actions }}
            onRetry={() => void load()}
            backHref={`/hr/recruitment/${jobOpeningId}`}
          />
        </Card>
      </div>
    );
  }

  if (notFound || !application) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("notFoundTitle")} subtitle={t("notFoundSubtitle")} back={`/hr/recruitment/${jobOpeningId}`} backLabel={t("backToApplications")} />
        <Card padding>
          <p style={{ color: "var(--mut)", textAlign: "center" }}>{t("notFoundMessage")}</p>
          <p style={{ textAlign: "center" }}>
            <Link href={`/hr/recruitment/${jobOpeningId}`} className="btn primary">{t("backToPipeline")}</Link>
          </p>
        </Card>
      </div>
    );
  }

  const basicPayPreviewMinor = rupeesToMinorString(basicRupees);
  // Known enum values get a translated label; anything else falls back to a humanised form, never the raw token.
  const enumLabel = (prefix: string, value: string) => (t.has(`${prefix}_${value}`) ? t(`${prefix}_${value}`) : humanizeStatus(value));
  // Step 4: restate exactly what Confirm Hire will create before the user commits.
  const deptName = departments.find((d) => d.id === departmentId)?.name;
  const desigName = designations.find((d) => d.id === designationId)?.name;
  const hireSummary = employeeNo.trim() && dateOfJoining && basicPayPreviewMinor && deptName && desigName
    ? t("hireSummary", {
        employeeNo: employeeNo.trim(), department: deptName, designation: desigName,
        date: formatIndianDate(dateOfJoining), amount: formatMoney(basicPayPreviewMinor),
      })
    : null;
  const canHire = application.stage === "selected" || application.stage === "offered";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={application.applicantName}
        subtitle={t("subtitle")}
        back={`/hr/recruitment/${jobOpeningId}`} backLabel={t("backToApplications")}
        actions={
          canHire && hirePhase === "idle" ? (
            <Button onClick={() => setShowHireDialog(true)}>
              {t("hire")}
            </Button>
          ) : undefined
        }
      />

      {hirePhase === "pending" && (
        <p role="status" aria-live="polite" className="pill warn" style={{ marginBottom: 12 }}>
          {hireMessage}
        </p>
      )}
      {hirePhase === "confirmed" && (
        <p role="status" aria-live="polite" className="pill good" style={{ marginBottom: 12 }}>
          {t("hireConfirmedMessage")}
        </p>
      )}
      {hirePhase === "stalled" && (
        <div role="alert" className="pill bad" style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>{t("hireStalledMessage")}</span>
          <Button variant="ghost" size="sm" onClick={() => { setHirePhase("idle"); setHireStatus("idle"); void load(); }}>{t("refresh")}</Button>
        </div>
      )}

      <Card title={t("summaryTitle")}>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
          {application.applicationNo && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("applicationNo")}</span><code style={{ fontSize: 12 }}>{application.applicationNo}</code></div>}
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("stage")}</span><span>{enumLabel("stage", application.stage)}</span></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("screeningDecision")}</span><span>{enumLabel("decision", application.screeningDecision)}</span></div>
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("source")}</span>{enumLabel("source", application.source)}</div>
          {application.email && (
            <div>
              <span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("email")}</span>
              {application.contactMasked === false
                ? application.email
                : <ContactReveal applicationId={application.id} applicantName={application.applicantName} email={application.email} scope="inbox" />}
            </div>
          )}
          {application.qualification && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("qualification")}</span>{application.qualification}</div>}
          {application.experienceYears != null && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("experience")}</span>{t("experienceYears", { count: application.experienceYears })}</div>}
          {application.category && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("category")}</span>{application.category}</div>}
          {application.dateOfBirth && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("dateOfBirth")}</span>{formatIndianDate(application.dateOfBirth)}</div>}
          {application.hasResume !== undefined && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("resume")}</span>{application.hasResume ? t("resumeOnFile") : t("resumeNone")}{application.resumeViewable && (<>{" "}<button type="button" style={{ textDecoration: "underline", background: "none", border: 0, color: "var(--primary, #4f46e5)", cursor: "pointer" }} onClick={() => void openResume()}>{t("viewResume")}</button></>)}{resumeError && <span role="alert" style={{ color: "var(--bad, #dc2626)", marginInlineStart: 8 }}>{resumeError}</span>}</div>}
          <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("applied")}</span>{formatIndianDate(application.appliedAt)}</div>
        </div>
      </Card>

      <div style={{ margin: "12px 0" }}>
        <Button variant="secondary" size="sm" onClick={() => setShowFee(true)}>{t("feeStatusButton")}</Button>
      </div>
      {showFee && <ApplicationFeeDialog applicationId={application.id} applicantName={application.applicantName} onClose={() => setShowFee(false)} />}

      <ApplicationExtras appId={appId} />

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
                  <label htmlFor={basicId} style={{ fontSize: 13, fontWeight: 500 }}>{t("basicPay")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  <input
                    id={basicId}
                    type="text"
                    inputMode="decimal"
                    value={basicRupees}
                    onChange={(e) => setBasicRupees(e.target.value)}
                    placeholder={t("basicPayPlaceholder")}
                    style={inputStyle}
                    required
                    aria-required="true"
                    aria-describedby={`${basicId}-hint`}
                  />
                  <p id={`${basicId}-hint`} style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>
                    {basicPayPreviewMinor ? t("basicPayPreview", { amount: formatMoney(basicPayPreviewMinor), minor: basicPayPreviewMinor }) : t("basicPayHint")}
                  </p>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label htmlFor={deptId} style={{ fontSize: 13, fontWeight: 500 }}>{t("department")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  <select id={deptId} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={inputStyle} required disabled={deptState !== "ready"} aria-describedby={deptState === "error" ? `${deptId}-err` : undefined}>
                    <option value="">{t("selectDepartment")}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {deptState === "error" && (
                    <p id={`${deptId}-err`} role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>
                      {t("departmentsLoadError")}{" "}
                      <button type="button" className="btn ghost sm" onClick={() => setLookupAttempt((n) => n + 1)}>{t("retry")}</button>
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={desigId} style={{ fontSize: 13, fontWeight: 500 }}>{t("designation")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span></label>
                  <select id={desigId} value={designationId} onChange={(e) => setDesignationId(e.target.value)} style={inputStyle} required disabled={desigState !== "ready"} aria-describedby={desigState === "error" ? `${desigId}-err` : undefined}>
                    <option value="">{t("selectDesignation")}</option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {desigState === "error" && (
                    <p id={`${desigId}-err`} role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>
                      {t("designationsLoadError")}{" "}
                      <button type="button" className="btn ghost sm" onClick={() => setLookupAttempt((n) => n + 1)}>{t("retry")}</button>
                    </p>
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

              {hireSummary && (
                <p style={{ fontSize: 13, background: "var(--bg2)", padding: "8px 12px", borderRadius: 8, margin: 0 }}>{hireSummary}</p>
              )}

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
    </div>
  );
}
