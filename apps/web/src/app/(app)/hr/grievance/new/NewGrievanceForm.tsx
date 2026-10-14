"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, EntityPicker, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { GRIEVANCE_CATEGORIES } from "../grievanceModel";

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
  const idemKey = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [filedDate, setFiledDate] = useState(todayIst());
  type FieldKey = "employee" | "category" | "subject" | "description" | "filedDate";
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function validate(): boolean {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!employeeId) errs.employee = t("employeeRequired");
    if (!category) errs.category = t("categoryRequired");
    if (subject.trim().length < 3) errs.subject = t("subjectRequired");
    if (description.trim().length < 10) errs.description = t("descriptionRequired");
    if (!filedDate || filedDate > todayIst()) errs.filedDate = t("filedDateInvalid");
    setErrors(errs);
    return Object.keys(errs).length === 0;
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
      <Field label={t("employeeLabel")} required error={errors.employee}>
        <EntityPicker
          value={employeeId}
          onChange={(v) => { setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v); setErrors((s) => { const n = { ...s }; delete n.employee; return n; }); }}
          search={searchEmployees}
          resolve={resolveEmployees}
          placeholder={t("employeePlaceholder")}
        />
      </Field>
      <div>
        <Field label={t("categoryLabel")} required error={errors.category}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("categoryPlaceholder")}</option>
            {GRIEVANCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`category_${c}` as never)}</option>)}
          </Select>
        </Field>
        <p style={{ fontSize: 12, color: "var(--mut)", margin: "4px 0 0" }}>{t("categoryHint")}</p>
      </div>
      <Field label={t("subjectLabel")} required error={errors.subject}>
        <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label={t("descriptionLabel")} required error={errors.description}>
        <Textarea value={description} maxLength={5000} rows={6} onChange={(e) => setDescription(e.target.value)} style={{ resize: "vertical" }} />
      </Field>
      <Field label={t("filedDateLabel")} required error={errors.filedDate}>
        <Input type="date" value={filedDate} max={todayIst()} onChange={(e) => setFiledDate(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" disabled={busy} style={{ minHeight: 44, minWidth: 160 }}>{t("submit")}</Button>
        <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => router.push("/hr/grievance")}>{t("cancel")}</Button>
      </div>
    </form>
  );
}
