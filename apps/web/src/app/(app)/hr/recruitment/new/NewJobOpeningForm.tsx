"use client";

import { useId, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Department = { id: string; name: string };

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink2)",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--r-sm)",
  background: "var(--panel)",
  color: "var(--ink)",
  minHeight: 44,
};

const inputInvalidStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "var(--bad)",
};

export function NewJobOpeningForm() {
  const t = useTranslations("recruitmentNewJob");
  const searchParams = useSearchParams();
  const templateId = searchParams.get("templateId");

  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [vacancies, setVacancies] = useState(1);
  const [vacancyType, setVacancyType] = useState("regular");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  // MEDIUM finding: payRange/selectionProcess/requiredDocuments/eligibility/
  // qualification from a selected template used to be silently lost -- the
  // fetch below read only name/vacancyType/description even though the
  // template response already carried the rest, and submit never sent
  // templateId at all (so jd-template-repo's useCount/traceability never
  // fired). qualification/payRange/selectionProcess get real, editable
  // fields below ("HR can override later", matching jd-template-routes.ts's
  // own comment on the equivalent /use endpoint); requiredDocuments/
  // eligibility are carried through as-is (no dedicated editor here -- a
  // list/JSON editor is a larger scope than this fix) so the data reaches
  // the job opening instead of vanishing.
  const [qualification, setQualification] = useState("");
  const [payRange, setPayRange] = useState("");
  const [selectionProcess, setSelectionProcess] = useState("");
  const [requiredDocuments, setRequiredDocuments] = useState<string[] | undefined>(undefined);
  const [eligibility, setEligibility] = useState<Record<string, unknown> | undefined>(undefined);

  // MEDIUM finding: this form used to be the only place in recruitment that
  // asked HR to paste a raw department UUID -- every other form (the Hire
  // dialog in applications/[appId]/page.tsx, TransferWithApproval.tsx) uses
  // this same name-based dropdown against this same endpoint. Falls back to
  // the raw UUID text box below if the list fails to load, exactly like
  // those other callers.
  const [departments, setDepartments] = useState<Department[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/hrms/departments?limit=200");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Department[] } | Department[];
        setDepartments(Array.isArray(body) ? body : (body.data ?? []));
      } catch { /* graceful fallback to the raw-UUID input below */ }
    })();
  }, []);

  useEffect(() => {
    if (!templateId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${templateId}`, {
          headers: { "content-type": "application/json" },
        });
        if (!res.ok) return;
        const tmpl = await res.json() as {
          name?: string; vacancyType?: string; description?: string; qualification?: string; payRange?: string;
          selectionProcess?: string; requiredDocuments?: string[]; eligibility?: Record<string, unknown>;
        };
        if (tmpl.name) { setTitle(tmpl.name); setTemplateName(tmpl.name); }
        if (tmpl.vacancyType) setVacancyType(tmpl.vacancyType);
        if (tmpl.description) setDescription(tmpl.description);
        if (tmpl.qualification) setQualification(tmpl.qualification);
        if (tmpl.payRange) setPayRange(tmpl.payRange);
        if (tmpl.selectionProcess) setSelectionProcess(tmpl.selectionProcess);
        if (tmpl.requiredDocuments) setRequiredDocuments(tmpl.requiredDocuments);
        if (tmpl.eligibility) setEligibility(tmpl.eligibility);
      } catch { /* ignore */ }
    })();
  }, [templateId]);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const formError = useFormError("job opening");

  const refNoId = useId();
  const titleId = useId();
  const deptId = useId();
  const vacanciesId = useId();
  const descId = useId();
  const closesAtId = useId();
  const statusMsgId = useId();
  const qualificationId = useId();
  const payRangeId = useId();
  const selectionProcessId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!refNo.trim()) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage(t("referenceNoRequired"));
      return;
    }
    if (refNo.trim().length > 64) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage(t("referenceNoTooLong"));
      return;
    }
    if (!title.trim()) {
      setStatus("error");
      setInvalidField("title");
      setMessage(t("titleRequired"));
      return;
    }
    if (!UUID_RE.test(departmentId.trim())) {
      setStatus("error");
      setInvalidField("departmentId");
      setMessage(t("departmentIdInvalid"));
      return;
    }
    if (vacancies < 1) {
      setStatus("error");
      setInvalidField("vacancies");
      setMessage(t("vacanciesMin"));
      return;
    }

    setStatus("submitting");
    setInvalidField(null);
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/hrms/job-openings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refNo: refNo.trim(),
          title: title.trim(),
          departmentId: departmentId.trim(),
          vacancies,
          vacancyType,
          description: description.trim() || undefined,
          closesAt: closesAt || undefined,
          qualification: qualification.trim() || undefined,
          payRange: payRange.trim() || undefined,
          selectionProcess: selectionProcess.trim() || undefined,
          // Carried through from the template unedited (see the state
          // comment above) -- undefined when no template was selected, or
          // the template had none, so nothing new is sent for a from-scratch
          // job opening.
          requiredDocuments,
          eligibility,
          // MEDIUM finding: previously never sent, so jd-template-repo's
          // useCount/traceability never fired for a job opening created via
          // this form even when it visibly said "Pre-filled from template".
          templateId: templateId || undefined,
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message);
        return;
      }

      // The API returns 202 Accepted (CQRS command queued), not a completed
      // creation — say so honestly rather than claiming it's done. Stay on
      // this page so the confirmation is actually seen (a redirect would
      // race it off-screen).
      setStatus("success");
      setMessage(t("submitSuccessMessage"));
    } catch {
      setStatus("error");
      setMessage(formError.fromException("save").message);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      {templateName && (
        <div style={{ padding: "10px 14px", background: "var(--infobg, #dbeafe)", border: "1px solid #93c5fd", borderRadius: 8, fontSize: 13, color: "var(--info, #1e40af)" }}>
          {t("prefilledFromTemplatePrefix")} <strong>{templateName}</strong>{t("prefilledFromTemplateSuffix")}
        </div>
      )}

      <div>
        <label htmlFor={refNoId} style={labelStyle}>
          {t("referenceNo")} <span aria-hidden="true">*</span>
        </label>
        <input
          id={refNoId}
          type="text"
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder={t("referenceNoPlaceholder")}
          style={invalidField === "refNo" ? inputInvalidStyle : inputStyle}
          required
          aria-required="true"
          aria-invalid={invalidField === "refNo"}
          maxLength={64}
        />
      </div>

      <div>
        <label htmlFor={titleId} style={labelStyle}>
          {t("title")} <span aria-hidden="true">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          style={invalidField === "title" ? inputInvalidStyle : inputStyle}
          required
          aria-required="true"
          aria-invalid={invalidField === "title"}
        />
      </div>

      <div>
        <label htmlFor={deptId} style={labelStyle}>
          {t("department")} <span aria-hidden="true">*</span>
        </label>
        {departments.length > 0 ? (
          <select
            id={deptId}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            style={invalidField === "departmentId" ? inputInvalidStyle : inputStyle}
            required
            aria-required="true"
            aria-invalid={invalidField === "departmentId"}
          >
            <option value="">Select department…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        ) : (
          <input
            id={deptId}
            type="text"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            placeholder={t("departmentIdPlaceholder")}
            style={invalidField === "departmentId" ? inputInvalidStyle : inputStyle}
            required
            aria-required="true"
            aria-invalid={invalidField === "departmentId"}
          />
        )}
      </div>

      <div>
        <label htmlFor={vacanciesId} style={labelStyle}>
          {t("vacancies")}
        </label>
        <input
          id={vacanciesId}
          type="number"
          min={1}
          value={vacancies}
          onChange={(e) => setVacancies(Number(e.target.value))}
          style={invalidField === "vacancies" ? inputInvalidStyle : inputStyle}
          required
          aria-invalid={invalidField === "vacancies"}
        />
      </div>

      <div>
        <label htmlFor={descId} style={labelStyle}>
          {t("description")}
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder={t("descriptionPlaceholder")}
          style={{ ...inputStyle, resize: "none", minHeight: 96 }}
        />
      </div>

      <div>
        <label htmlFor={qualificationId} style={labelStyle}>
          {t("qualification")}
        </label>
        <input
          id={qualificationId}
          type="text"
          value={qualification}
          onChange={(e) => setQualification(e.target.value)}
          placeholder={t("qualificationPlaceholder")}
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor={payRangeId} style={labelStyle}>
          {t("payRange")}
        </label>
        <input
          id={payRangeId}
          type="text"
          value={payRange}
          onChange={(e) => setPayRange(e.target.value)}
          placeholder={t("payRangePlaceholder")}
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor={selectionProcessId} style={labelStyle}>
          {t("selectionProcess")}
        </label>
        <textarea
          id={selectionProcessId}
          value={selectionProcess}
          onChange={(e) => setSelectionProcess(e.target.value)}
          rows={3}
          placeholder={t("selectionProcessPlaceholder")}
          style={{ ...inputStyle, resize: "none", minHeight: 72 }}
        />
      </div>

      <div>
        <label htmlFor={closesAtId} style={labelStyle}>
          {t("closingDate")}
        </label>
        <input
          id={closesAtId}
          type="date"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button
          type="submit"
          disabled={status === "submitting" || status === "success"}
          variant="primary"
          style={{ minHeight: 44, alignSelf: "flex-start" }}
        >
          {status === "submitting" ? t("creating") : status === "success" ? t("submitted") : t("createJobOpening")}
        </Button>
        {status === "success" && (
          <Link href="/hr/recruitment" className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
            {t("backToRecruitment")}
          </Link>
        )}
      </div>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          style={{
            fontSize: 14,
            color: status === "error" ? "var(--bad)" : "var(--good)",
            margin: 0,
          }}
        >
          <strong>{status === "error" ? t("errorPrefix") : t("successPrefix")}</strong>
          {message}
        </p>
      )}
    </form>
  );
}
