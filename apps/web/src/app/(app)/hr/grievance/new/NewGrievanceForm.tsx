"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, EntityPicker } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { GRIEVANCE_CATEGORIES } from "../grievanceModel";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
  border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg2)", color: "var(--ink)", minHeight: 44,
};
const errStyle: React.CSSProperties = { color: "var(--bad, #b91c1c)", fontSize: 12, margin: "3px 0 0" };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 };

/** IST calendar date (YYYY-MM-DD) -- the register's day, not the browser's. */
function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * GAP-HR-GRIEVANCE-02: register a grievance. The employee is picked (never a
 * typed id). One idempotency key per form instance rides the
 * x-idempotency-key header -- the only header the BFF proxy forwards -- so a
 * double-click or a retried submit registers ONE case.
 */
export function NewGrievanceForm() {
  const t = useTranslations("grievanceNew");
  const router = useRouter();
  const formError = useFormError("grievance");
  const id = useId();
  const idemKey = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [filedDate, setFiledDate] = useState(todayIst());
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function validate(): boolean {
    const errs = new Set<string>();
    if (!employeeId) errs.add("employee");
    if (!category) errs.add("category");
    if (subject.trim().length < 3) errs.add("subject");
    if (description.trim().length < 10) errs.add("description");
    if (!filedDate || filedDate > todayIst()) errs.add("filedDate");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/grievances", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idemKey.current },
        body: JSON.stringify({ employeeId, category, subject: subject.trim(), description: description.trim(), filedDate }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        setBusy(false);
        return;
      }
      router.push("/hr/grievance");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: "grid", gap: 14, maxWidth: 640 }}>
      {/* POSH Act, 2013: sexual-harassment complaints belong with the Internal
          Committee, not this register, so there is deliberately no such category. */}
      <p role="note" style={{ margin: 0, padding: "10px 12px", border: "1px solid var(--warnbd, #f5d78e)", background: "var(--warnbg, #fffbe6)", borderRadius: 8, fontSize: 13 }}>
        {t.rich("iccNote", { link: (chunks) => <Link href="/hr/icc">{chunks}</Link> })}
      </p>
      {error && <p role="alert" className="pill bad" style={{ margin: 0 }}>{error}</p>}
      <div>
        <label htmlFor={`${id}-emp`} style={labelStyle}>{t("employeeLabel")} *</label>
        <EntityPicker
          id={`${id}-emp`}
          value={employeeId}
          onChange={(v) => { setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v); setInvalid((s) => { const n = new Set(s); n.delete("employee"); return n; }); }}
          search={searchEmployees}
          resolve={resolveEmployees}
          placeholder={t("employeePlaceholder")}
        />
        {invalid.has("employee") && <p role="alert" style={errStyle}>{t("employeeRequired")}</p>}
      </div>
      <div>
        <label htmlFor={`${id}-cat`} style={labelStyle}>{t("categoryLabel")} *</label>
        <select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} aria-invalid={invalid.has("category")}>
          <option value="">{t("categoryPlaceholder")}</option>
          {GRIEVANCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`category_${c}` as never)}</option>)}
        </select>
        {invalid.has("category") && <p role="alert" style={errStyle}>{t("categoryRequired")}</p>}
        <p style={{ fontSize: 12, color: "var(--mut)", margin: "4px 0 0" }}>{t("categoryHint")}</p>
      </div>
      <div>
        <label htmlFor={`${id}-subj`} style={labelStyle}>{t("subjectLabel")} *</label>
        <input id={`${id}-subj`} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} style={inputStyle} aria-invalid={invalid.has("subject")} />
        {invalid.has("subject") && <p role="alert" style={errStyle}>{t("subjectRequired")}</p>}
      </div>
      <div>
        <label htmlFor={`${id}-desc`} style={labelStyle}>{t("descriptionLabel")} *</label>
        <textarea id={`${id}-desc`} value={description} maxLength={5000} rows={6} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} aria-invalid={invalid.has("description")} />
        {invalid.has("description") && <p role="alert" style={errStyle}>{t("descriptionRequired")}</p>}
      </div>
      <div>
        <label htmlFor={`${id}-date`} style={labelStyle}>{t("filedDateLabel")} *</label>
        <input id={`${id}-date`} type="date" value={filedDate} max={todayIst()} onChange={(e) => setFiledDate(e.target.value)} style={inputStyle} aria-invalid={invalid.has("filedDate")} />
        {invalid.has("filedDate") && <p role="alert" style={errStyle}>{t("filedDateInvalid")}</p>}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" disabled={busy} style={{ minHeight: 44, minWidth: 160 }}>{t("submit")}</Button>
        <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => router.push("/hr/grievance")}>{t("cancel")}</Button>
      </div>
    </form>
  );
}
