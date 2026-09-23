"use client";
import { useState, useId, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader, Card, Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type EmployeeOption = { id: string; name?: string; employeeNo?: string };

export default function AparNewPage() {
  const t = useTranslations("aparNew");
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
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  // UX: replaces the 4 raw UUID text boxes below (employee, reporting
  // officer, reviewing officer, accepting authority) with searchable
  // name-based dropdowns, matching the pattern already used by
  // PromoteWithApproval/TransferWithApproval. All 4 roles are picked from
  // the same employee directory.
  useEffect(() => {
    fetch("/api/proxy/v1/hrms/employees?limit=200")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data?: EmployeeOption[] } | EmployeeOption[]) => {
        setEmployees(Array.isArray(body) ? body : (body.data ?? []));
      })
      .catch(() => { /* graceful fallback to raw-UUID inputs below */ });
  }, []);

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
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/apar" />

      <div style={{ maxWidth: 600, marginTop: 20 }}>
      <Card title={t("cardTitle")}>
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={empId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("employeeIdLabel")}</label>
            {employees.length > 0 ? (
              <select id={empId} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}</option>
                ))}
              </select>
            ) : (
              <input id={empId} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
                placeholder={t("employeeIdPlaceholder")} required pattern="[0-9a-f-]{36}" />
            )}
            {formError.fieldError("employeeId") && (
              <p style={{ color: "var(--red, #c00)", fontSize: 12, margin: "4px 0 0" }}>{formError.fieldError("employeeId")}</p>
            )}
          </div>
          <div>
            <label htmlFor={periodId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("periodLabel")}</label>
            <input id={periodId} value={appraisalPeriod} onChange={(e) => setAppraisalPeriod(e.target.value)}
              placeholder={t("periodPlaceholder")} required maxLength={16} />
          </div>
          <div>
            <label htmlFor={roId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("reportingOfficerLabel")}</label>
            {employees.length > 0 ? (
              <select id={roId} value={reportingOfficerId} onChange={(e) => setReportingOfficerId(e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}</option>
                ))}
              </select>
            ) : (
              <input id={roId} value={reportingOfficerId} onChange={(e) => setReportingOfficerId(e.target.value)}
                placeholder={t("reportingOfficerPlaceholder")} required pattern="[0-9a-f-]{36}" />
            )}
          </div>
          <div>
            <label htmlFor={rvId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("reviewingOfficerLabel")}</label>
            {employees.length > 0 ? (
              <select id={rvId} value={reviewingOfficerId} onChange={(e) => setReviewingOfficerId(e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}</option>
                ))}
              </select>
            ) : (
              <input id={rvId} value={reviewingOfficerId} onChange={(e) => setReviewingOfficerId(e.target.value)}
                placeholder={t("reviewingOfficerPlaceholder")} required pattern="[0-9a-f-]{36}" />
            )}
          </div>
          <div>
            <label htmlFor={aaId} style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>{t("acceptingAuthorityLabel")}</label>
            {employees.length > 0 ? (
              <select id={aaId} value={acceptingAuthorityId} onChange={(e) => setAcceptingAuthorityId(e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name ?? emp.id}{emp.employeeNo ? ` (${emp.employeeNo})` : ""}</option>
                ))}
              </select>
            ) : (
              <input id={aaId} value={acceptingAuthorityId} onChange={(e) => setAcceptingAuthorityId(e.target.value)}
                placeholder={t("acceptingAuthorityPlaceholder")} required pattern="[0-9a-f-]{36}" />
            )}
          </div>
          {msg && (
            <p style={{ color: status === "error" ? "var(--red, #c00)" : "var(--green, #0a0)", fontSize: 13 }}>
              {msg}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => router.push("/hr/apar")}>{t("cancelBtn")}</Button>
            <Button type="submit" variant="primary" disabled={status === "submitting"}>
              {status === "submitting" ? t("initiatingBtn") : t("initiateBtn")}
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </main>
  );
}
