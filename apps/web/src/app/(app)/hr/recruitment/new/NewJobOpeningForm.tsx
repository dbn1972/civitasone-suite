"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  JOB_OPENING_FIELD_ORDER, JOB_OPENING_LIMITS, VACANCY_TYPES, isVacancyType, payMinorFromRupees, validateJobOpeningForm,
  type JobOpeningField, type JobOpeningFieldError,
} from "@/lib/recruitment";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { formatMoney, todayIST } from "@/lib/formatters";
import { Button } from "@/app/_components/ds";
import { RequisitionRequiredNotice } from "./RequisitionRequiredNotice";
import { useRequisitionPolicy, isRequisitionRequiredResponse } from "./requisitionPolicy";

type NamedOption = { id: string; name: string };
type LookupState = "loading" | "ready" | "error";

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

const helpStyle: React.CSSProperties = { fontSize: 12, color: "var(--mut)", margin: "4px 0 0" };
const errorStyle: React.CSSProperties = { fontSize: 12, color: "var(--bad)", margin: "4px 0 0" };

// The service reports amounts in paise; this form edits them in rupees.
const SERVER_FIELD_TO_FORM_FIELD: Record<string, JobOpeningField> = { payMinMinor: "payMinRupees", payMaxMinor: "payMaxRupees" };

async function fetchList<T>(url: string, signal?: AbortSignal): Promise<T[] | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T[] } | T[];
    const list = Array.isArray(body) ? body : body.data;
    return Array.isArray(list) ? list : null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return null;
  }
}

/** Display text for the Pay Range field, composed from the structured level + min/max (paise). */
function composePayRange(level: string, minMinor: string | undefined | null, maxMinor: string | undefined | null): string {
  const parts: string[] = [];
  if (level.trim()) parts.push(`Level ${level.trim()}`);
  if (typeof minMinor === "string" && typeof maxMinor === "string") parts.push(`${formatMoney(minMinor)} - ${formatMoney(maxMinor)}`);
  else if (typeof minMinor === "string") parts.push(`${formatMoney(minMinor)}+`);
  else if (typeof maxMinor === "string") parts.push(`up to ${formatMoney(maxMinor)}`);
  return parts.join(", ").slice(0, JOB_OPENING_LIMITS.payRange);
}

export function NewJobOpeningForm() {
  const t = useTranslations("recruitmentNewJob");
  const searchParams = useSearchParams();
  const templateId = searchParams.get("templateId");

  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [vacancies, setVacancies] = useState(1);
  const [vacancyType, setVacancyType] = useState("regular");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [postedAt, setPostedAt] = useState(() => todayIST());
  const [location, setLocation] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [qualification, setQualification] = useState("");
  const [payRange, setPayRange] = useState("");
  const [payRangeTouched, setPayRangeTouched] = useState(false);
  const [payLevel, setPayLevel] = useState("");
  const [payMinRupees, setPayMinRupees] = useState("");
  const [payMaxRupees, setPayMaxRupees] = useState("");
  const [selectionProcess, setSelectionProcess] = useState("");
  // GAP-RECRUITMENT-NEW-05: both come from a template but are now visible and editable.
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [eligibility, setEligibility] = useState<Record<string, unknown> | undefined>(undefined);
  const templateHadAllowMultiple = useRef(false);

  // Departments are required and designations optional; both are name-based selects (never free-text UUIDs).
  const [departments, setDepartments] = useState<NamedOption[]>([]);
  const [deptState, setDeptState] = useState<LookupState>("loading");
  const [designations, setDesignations] = useState<NamedOption[]>([]);
  const [desigState, setDesigState] = useState<LookupState>("loading");
  const [payLevels, setPayLevels] = useState<string[] | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  // GAP-RECRUITMENT-NEW-06: Govt editions create vacancies only by publishing an approved requisition.
  // The server enforces this on POST /job-openings; the form just says so up front.
  const { requisitionRequired, markRequired } = useRequisitionPolicy();

  useEffect(() => {
    const controller = new AbortController();
    setDeptState("loading");
    setDesigState("loading");
    void (async () => {
      try {
        const [depts, desigs, levels] = await Promise.all([
          fetchList<NamedOption>("/api/proxy/v1/hrms/departments?limit=200", controller.signal),
          fetchList<NamedOption>("/api/proxy/v1/hrms/designations?limit=200", controller.signal),
          fetchList<{ level: number | string }>("/api/proxy/v1/hrms/pay-matrix", controller.signal),
        ]);
        setDepartments(depts ?? []);
        setDeptState(depts ? "ready" : "error");
        setDesignations(desigs ?? []);
        setDesigState(desigs ? "ready" : "error");
        setPayLevels(levels ? levels.map((l) => String(l.level)) : null);
      } catch {
        /* aborted on unmount */
      }
    })();
    return () => controller.abort();
  }, [lookupAttempt]);

  useEffect(() => {
    if (!templateId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${templateId}`, {
          headers: { "content-type": "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const tmpl = await res.json() as {
          name?: string; vacancyType?: string; description?: string; qualification?: string; payRange?: string;
          selectionProcess?: string; requiredDocuments?: string[]; eligibility?: Record<string, unknown>;
        };
        if (tmpl.name) { setTitle(tmpl.name); setTemplateName(tmpl.name); }
        if (isVacancyType(tmpl.vacancyType)) setVacancyType(tmpl.vacancyType);
        if (tmpl.description) setDescription(tmpl.description);
        if (tmpl.qualification) setQualification(tmpl.qualification);
        if (tmpl.payRange) { setPayRange(tmpl.payRange); setPayRangeTouched(true); }
        if (tmpl.selectionProcess) setSelectionProcess(tmpl.selectionProcess);
        if (Array.isArray(tmpl.requiredDocuments)) setRequiredDocuments(tmpl.requiredDocuments);
        if (tmpl.eligibility) {
          templateHadAllowMultiple.current = "allowMultiple" in tmpl.eligibility;
          setEligibility(tmpl.eligibility);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        /* ignore */
      }
    })();
    return () => controller.abort();
  }, [templateId]);

  // Auto-compose the Pay Range display text from the structured fields until HR edits it by hand.
  useEffect(() => {
    if (payRangeTouched) return;
    setPayRange(composePayRange(payLevel, payMinorFromRupees(payMinRupees), payMinorFromRupees(payMaxRupees)));
  }, [payLevel, payMinRupees, payMaxRupees, payRangeTouched]);

  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [clientErrors, setClientErrors] = useState<Partial<Record<JobOpeningField, JobOpeningFieldError>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<JobOpeningField, string>>>({});
  const [focusRequest, setFocusRequest] = useState<{ field: JobOpeningField; n: number } | null>(null);
  const formError = useFormError("job opening");
  const messageRef = useRef<HTMLParagraphElement>(null);

  const base = useId();
  const fid = (f: string) => `${base}-${f}`;
  const statusMsgId = useId();

  useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(fid(focusRequest.field));
    el?.focus();
    el?.scrollIntoView?.({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fid derives from the stable useId base
  }, [focusRequest]);

  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  const errorText = useCallback((e: JobOpeningFieldError): string => {
    switch (e.code) {
      case "refNoRequired": return t("referenceNoRequired");
      case "titleRequired": return t("titleRequired");
      case "departmentRequired": return t("departmentIdInvalid");
      case "vacanciesMin": return t("vacanciesMin");
      case "tooLong": return t("errTooLong", { max: e.max ?? 0 });
      case "invalidDate": return t("errInvalidDate");
      case "invalidAmount": return t("errInvalidAmount");
      case "minGreaterThanMax": return t("errMinGreaterThanMax");
      case "tooManyDocuments": return t("errTooManyDocuments", { max: e.max ?? 0 });
      case "documentTooLong": return t("errDocumentTooLong", { max: e.max ?? 0 });
      case "invalidId": return t("errInvalidId");
    }
  }, [t]);

  const fieldMessage = (f: JobOpeningField): string | undefined => {
    const c = clientErrors[f];
    return c ? errorText(c) : serverErrors[f];
  };
  const invalid = (f: JobOpeningField) => Boolean(fieldMessage(f));
  const fieldProps = (f: JobOpeningField) => ({
    id: fid(f),
    "aria-invalid": invalid(f) || undefined,
    "aria-describedby": invalid(f) ? `${fid(f)}-err` : undefined,
    style: invalid(f) ? inputInvalidStyle : inputStyle,
  });
  const fieldError = (f: JobOpeningField) =>
    invalid(f) ? <p id={`${fid(f)}-err`} style={errorStyle}>{fieldMessage(f)}</p> : null;

  const fieldLabels: Record<JobOpeningField, string> = {
    refNo: t("referenceNo"), title: t("title"), departmentId: t("department"), designationId: t("designation"),
    vacancies: t("vacancies"), description: t("description"), qualification: t("qualification"), payRange: t("payRange"),
    payLevel: t("payLevel"), payMinRupees: t("payMin"), payMaxRupees: t("payMax"), selectionProcess: t("selectionProcess"),
    location: t("location"), postedAt: t("postedDate"), closesAt: t("closingDate"), requiredDocuments: t("requiredDocuments"),
  };
  const errorFields = JOB_OPENING_FIELD_ORDER.filter((f) => invalid(f));

  const allowMultiple = eligibility?.allowMultiple === true;
  const otherEligibility = Object.entries(eligibility ?? {}).filter(([k]) => k !== "allowMultiple");

  function toggleAllowMultiple(checked: boolean) {
    const next = { ...(eligibility ?? {}) };
    if (checked) next.allowMultiple = true;
    else if (templateHadAllowMultiple.current) next.allowMultiple = false;
    else delete next.allowMultiple;
    setEligibility(Object.keys(next).length > 0 ? next : undefined);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateJobOpeningForm({
      refNo, title, departmentId, designationId, vacancies, description, qualification, payRange, payLevel,
      payMinRupees, payMaxRupees, selectionProcess, location, postedAt, closesAt, requiredDocuments,
    });
    setClientErrors(errors);
    setServerErrors({});
    const failing = JOB_OPENING_FIELD_ORDER.filter((f) => errors[f]);
    if (failing.length > 0) {
      setStatus("error");
      setMessage("");
      setFocusRequest({ field: failing[0], n: Date.now() });
      return;
    }

    setStatus("submitting");
    setMessage("");

    const payMinMinor = payMinorFromRupees(payMinRupees);
    const payMaxMinor = payMinorFromRupees(payMaxRupees);
    const docs = requiredDocuments.map((d) => d.trim()).filter(Boolean);

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
          // GAP-RECRUITMENT-NEW-02: structured pay (level + paise as decimal strings).
          payLevel: payLevel.trim() || undefined,
          payMinMinor: typeof payMinMinor === "string" ? payMinMinor : undefined,
          payMaxMinor: typeof payMaxMinor === "string" ? payMaxMinor : undefined,
          selectionProcess: selectionProcess.trim() || undefined,
          // GAP-RECRUITMENT-NEW-03: only sent when set. isPublished stays false: publishing is a separate
          // action on the vacancy page.
          location: location.trim() || undefined,
          designationId: designationId.trim() || undefined,
          postedAt: postedAt || undefined,
          // GAP-RECRUITMENT-NEW-05: required documents (only when non-empty) and eligibility, which keeps
          // every template key and adds allowMultiple.
          requiredDocuments: docs.length > 0 ? docs : undefined,
          eligibility,
          // Traceability: which template (if any) this opening was created from.
          templateId: templateId || undefined,
        }),
      });

      if (!res.ok) {
        if (await isRequisitionRequiredResponse(res)) {
          markRequired();
          setStatus("idle");
          setMessage("");
          return;
        }
        const resolved = await formError.fromResponse(res, "save");
        // Server fieldErrors (VALIDATION_FAILED) land under their own field instead of only a summary line.
        const mapped: Partial<Record<JobOpeningField, string>> = {};
        for (const [field, msg] of Object.entries(resolved.fieldErrors)) {
          const f = (SERVER_FIELD_TO_FORM_FIELD[field] ?? field) as JobOpeningField;
          if ((JOB_OPENING_FIELD_ORDER as string[]).includes(f)) mapped[f] = msg;
        }
        setServerErrors(mapped);
        const first = JOB_OPENING_FIELD_ORDER.find((f) => mapped[f]);
        if (first) setFocusRequest({ field: first, n: Date.now() });
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

  const deptSelectable = deptState === "ready";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      {requisitionRequired && <RequisitionRequiredNotice />}
      {errorFields.length > 0 && (
        <div role="alert" style={{ padding: "10px 14px", border: "1px solid var(--bad)", borderRadius: 8, fontSize: 13, color: "var(--bad)" }}>
          <strong>{t("errorSummary", { count: errorFields.length })}</strong>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
            {errorFields.map((f) => (
              <li key={f}><a href={`#${fid(f)}`} style={{ color: "inherit" }} onClick={(ev) => { ev.preventDefault(); setFocusRequest({ field: f, n: Date.now() }); }}>{fieldLabels[f]}</a></li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p
          ref={messageRef}
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

      {templateName && (
        <div style={{ padding: "10px 14px", background: "var(--infobg, #dbeafe)", border: "1px solid #93c5fd", borderRadius: 8, fontSize: 13, color: "var(--info, #1e40af)" }}>
          {t("prefilledFromTemplatePrefix")} <strong>{templateName}</strong>{t("prefilledFromTemplateSuffix")}
        </div>
      )}

      <div>
        <label htmlFor={fid("refNo")} style={labelStyle}>
          {t("referenceNo")} <span aria-hidden="true">*</span>
        </label>
        <input
          {...fieldProps("refNo")}
          type="text"
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder={t("referenceNoPlaceholder")}
          required
          aria-required="true"
          maxLength={JOB_OPENING_LIMITS.refNo}
        />
        {fieldError("refNo")}
      </div>

      <div>
        <label htmlFor={fid("title")} style={labelStyle}>
          {t("title")} <span aria-hidden="true">*</span>
        </label>
        <input
          {...fieldProps("title")}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          required
          aria-required="true"
          maxLength={JOB_OPENING_LIMITS.title}
        />
        {fieldError("title")}
      </div>

      <div>
        <label htmlFor={fid("vacancyType")} style={labelStyle}>{t("vacancyType")}</label>
        <select
          id={fid("vacancyType")}
          value={vacancyType}
          onChange={(e) => setVacancyType(e.target.value)}
          style={inputStyle}
        >
          {VACANCY_TYPES.map((v) => (
            <option key={v} value={v}>{t(`vacancyType_${v}`)}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={fid("departmentId")} style={labelStyle}>
          {t("department")} <span aria-hidden="true">*</span>
        </label>
        <select
          {...fieldProps("departmentId")}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          required
          aria-required="true"
          disabled={!deptSelectable}
        >
          <option value="">{t("selectDepartment")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {fieldError("departmentId")}
        {deptState === "error" && (
          <p role="alert" style={errorStyle}>
            {t("departmentsLoadError")}{" "}
            <button type="button" className="btn ghost sm" onClick={() => setLookupAttempt((n) => n + 1)}>{t("retry")}</button>
          </p>
        )}
      </div>

      <div>
        <label htmlFor={fid("designationId")} style={labelStyle}>{t("designation")}</label>
        <select
          {...fieldProps("designationId")}
          value={designationId}
          onChange={(e) => setDesignationId(e.target.value)}
          disabled={desigState !== "ready"}
        >
          <option value="">{t("noDesignation")}</option>
          {designations.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {fieldError("designationId")}
        {desigState === "error" && (
          <p style={helpStyle}>
            {t("designationsLoadError")}{" "}
            <button type="button" className="btn ghost sm" onClick={() => setLookupAttempt((n) => n + 1)}>{t("retry")}</button>
          </p>
        )}
      </div>

      <div>
        <label htmlFor={fid("vacancies")} style={labelStyle}>
          {t("vacancies")}
        </label>
        <input
          {...fieldProps("vacancies")}
          type="number"
          min={1}
          value={Number.isNaN(vacancies) ? "" : vacancies}
          onChange={(e) => setVacancies(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          required
        />
        {fieldError("vacancies")}
      </div>

      <div>
        <label htmlFor={fid("location")} style={labelStyle}>{t("location")}</label>
        <input
          {...fieldProps("location")}
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("locationPlaceholder")}
          maxLength={JOB_OPENING_LIMITS.location}
        />
        {fieldError("location")}
      </div>

      <div>
        <label htmlFor={fid("postedAt")} style={labelStyle}>{t("postedDate")}</label>
        <input
          {...fieldProps("postedAt")}
          type="date"
          value={postedAt}
          onChange={(e) => setPostedAt(e.target.value)}
        />
        <p style={helpStyle}>{t("publishHelp")}</p>
        {fieldError("postedAt")}
      </div>

      <div>
        <label htmlFor={fid("description")} style={labelStyle}>
          {t("description")}
        </label>
        <textarea
          {...fieldProps("description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder={t("descriptionPlaceholder")}
          maxLength={JOB_OPENING_LIMITS.description}
          style={{ ...(invalid("description") ? inputInvalidStyle : inputStyle), resize: "none", minHeight: 96 }}
        />
        {fieldError("description")}
      </div>

      <div>
        <label htmlFor={fid("qualification")} style={labelStyle}>
          {t("qualification")}
        </label>
        <input
          {...fieldProps("qualification")}
          type="text"
          value={qualification}
          onChange={(e) => setQualification(e.target.value)}
          placeholder={t("qualificationPlaceholder")}
          maxLength={JOB_OPENING_LIMITS.qualification}
        />
        {fieldError("qualification")}
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", margin: 0, display: "grid", gap: 12 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", padding: "0 6px" }}>{t("payGroup")}</legend>
        <div>
          <label htmlFor={fid("payLevel")} style={labelStyle}>{t("payLevel")}</label>
          {payLevels && payLevels.length > 0 ? (
            <select {...fieldProps("payLevel")} value={payLevel} onChange={(e) => setPayLevel(e.target.value)}>
              <option value="">{t("noPayLevel")}</option>
              {payLevels.map((l) => (
                <option key={l} value={l}>{t("payLevelOption", { level: l })}</option>
              ))}
            </select>
          ) : (
            <input {...fieldProps("payLevel")} type="text" value={payLevel} onChange={(e) => setPayLevel(e.target.value)} maxLength={JOB_OPENING_LIMITS.payLevel} placeholder={t("payLevelPlaceholder")} />
          )}
          {fieldError("payLevel")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label htmlFor={fid("payMinRupees")} style={labelStyle}>{t("payMin")}</label>
            <input {...fieldProps("payMinRupees")} type="text" inputMode="decimal" value={payMinRupees} onChange={(e) => setPayMinRupees(e.target.value)} placeholder={t("payAmountPlaceholder")} />
            {fieldError("payMinRupees")}
          </div>
          <div>
            <label htmlFor={fid("payMaxRupees")} style={labelStyle}>{t("payMax")}</label>
            <input {...fieldProps("payMaxRupees")} type="text" inputMode="decimal" value={payMaxRupees} onChange={(e) => setPayMaxRupees(e.target.value)} placeholder={t("payAmountPlaceholder")} />
            {fieldError("payMaxRupees")}
          </div>
        </div>
        <div>
          <label htmlFor={fid("payRange")} style={labelStyle}>
            {t("payRange")}
          </label>
          <input
            {...fieldProps("payRange")}
            type="text"
            value={payRange}
            onChange={(e) => { setPayRange(e.target.value); setPayRangeTouched(true); }}
            placeholder={t("payRangePlaceholder")}
            maxLength={JOB_OPENING_LIMITS.payRange}
          />
          <p style={helpStyle}>{t("payRangeHelp")}</p>
          {fieldError("payRange")}
        </div>
      </fieldset>

      <div>
        <label htmlFor={fid("selectionProcess")} style={labelStyle}>
          {t("selectionProcess")}
        </label>
        <textarea
          {...fieldProps("selectionProcess")}
          value={selectionProcess}
          onChange={(e) => setSelectionProcess(e.target.value)}
          rows={3}
          placeholder={t("selectionProcessPlaceholder")}
          maxLength={JOB_OPENING_LIMITS.selectionProcess}
          style={{ ...(invalid("selectionProcess") ? inputInvalidStyle : inputStyle), resize: "none", minHeight: 72 }}
        />
        {fieldError("selectionProcess")}
      </div>

      <fieldset id={fid("requiredDocuments")} tabIndex={-1} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", margin: 0, display: "grid", gap: 8 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", padding: "0 6px" }}>{t("requiredDocuments")}</legend>
        {requiredDocuments.map((doc, i) => (
          <div key={`doc-${i}`} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              aria-label={t("documentRowLabel", { n: i + 1 })}
              value={doc}
              maxLength={JOB_OPENING_LIMITS.requiredDocumentLength}
              onChange={(e) => setRequiredDocuments((prev) => prev.map((d, j) => (j === i ? e.target.value : d)))}
              style={inputStyle}
            />
            <button type="button" className="btn ghost" aria-label={t("removeDocument", { n: i + 1 })} onClick={() => setRequiredDocuments((prev) => prev.filter((_, j) => j !== i))}>
              {t("remove")}
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn ghost"
            disabled={requiredDocuments.length >= JOB_OPENING_LIMITS.requiredDocuments}
            onClick={() => setRequiredDocuments((prev) => [...prev, ""])}
          >
            {t("addDocument")}
          </button>
        </div>
        <p style={helpStyle}>{t("requiredDocumentsHelp", { max: JOB_OPENING_LIMITS.requiredDocuments })}</p>
        {fieldError("requiredDocuments")}
      </fieldset>

      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
          <input type="checkbox" checked={allowMultiple} onChange={(e) => toggleAllowMultiple(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{t("allowMultiple")}</span>
        </label>
        <p style={helpStyle}>{t("allowMultipleHelp")}</p>
        {otherEligibility.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <strong>{t("inheritedEligibility")}</strong>
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
              {otherEligibility.map(([k, v]) => (
                <li key={k}><code>{k}</code>: {typeof v === "string" ? v : JSON.stringify(v)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <label htmlFor={fid("closesAt")} style={labelStyle}>
          {t("closingDate")}
        </label>
        <input
          {...fieldProps("closesAt")}
          type="date"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
        />
        {fieldError("closesAt")}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button
          type="submit"
          disabled={status === "submitting" || status === "success" || deptState === "error" || requisitionRequired}
          variant="primary"
          className="btn-tall"
          style={{ alignSelf: "flex-start" }}
        >
          {status === "submitting" ? t("creating") : status === "success" ? t("submitted") : t("createJobOpening")}
        </Button>
        {status === "success" && (
          <Link href="/hr/recruitment" className="btn ghost btn-tall">
            {t("backToRecruitment")}
          </Link>
        )}
      </div>
    </form>
  );
}
