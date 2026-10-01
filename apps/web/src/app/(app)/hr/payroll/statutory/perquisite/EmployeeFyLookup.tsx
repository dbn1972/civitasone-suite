"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, EntityPicker } from "../../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { recentFinancialYears } from "@/lib/fiscalYear";

/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-05: employeeId used to be a pasted raw
 * UUID with no picker, and FY a free-text field checked only for
 * non-emptiness -- a typo in either silently looks up the wrong employee or
 * the wrong FY ("no data found", not an error). Now uses the shared
 * EntityPicker (ds/EntityPicker.tsx, already built for this exact "pick an
 * employee" case -- SF-06) over the existing employee directory adapter, and
 * a <select> of the current FY plus the last few, so only well-formed values
 * can ever be submitted.
 */
export function EmployeeFyLookup({ employeeId, fy }: { employeeId: string; fy: string }) {
  const t = useTranslations("employeeFyLookup");
  const router = useRouter();
  const [empId, setEmpId] = useState<string | null>(employeeId || null);
  const fyOptions = recentFinancialYears(6);
  const [fyValue, setFyValue] = useState(fy && fyOptions.includes(fy) ? fy : fyOptions[0]!);
  const [error, setError] = useState<string | null>(null);
  const fyId = useId();
  const errId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId) {
      setError(t("requiredError"));
      return;
    }
    setError(null);
    router.push(`/hr/payroll/statutory/perquisite?employeeId=${encodeURIComponent(empId)}&fy=${encodeURIComponent(fyValue)}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
            <label id={`${errId}-emp-label`} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <EntityPicker
              value={empId}
              onChange={(v) => setEmpId(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchEmployees}
              resolve={resolveEmployees}
              aria-label={t("employeeIdLabel")}
              placeholder={t("employeePickerPlaceholder")}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select
              id={fyId}
              value={fyValue}
              onChange={(e) => setFyValue(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
            >
              {fyOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }}>{t("submitBtn")}</Button>
        </div>
        {error && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
            {error}
          </p>
        )}
      </Card>
    </form>
  );
}
