"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card } from "../../../../../_components/ds";

/**
 * GAP-PAYROLL-STATUTORY-CHALLANS-04: 24Q and 26Q challans/reconciliation
 * were indistinguishable in the UI -- IngestChallanForm already lets the
 * user pick a form type at ingest, but neither the challans list nor the
 * reconcile query ever passed formType, so the two were always mixed
 * together (in practice, always read back as the backend's own "24Q"
 * default). The backend GET handlers for both /challans and /reconcile
 * already accept &formType= (services/payroll-service/src/modules/
 * statutory-returns/challan-routes.ts) -- this wires an existing,
 * verified-from-source query param, not an invented one.
 */
export function PeriodSelector({ period, formType }: { period: string; formType: "24Q" | "26Q" }) {
  const t = useTranslations("periodSelector");
  const router = useRouter();
  const [value, setValue] = useState(period);
  const [formTypeValue, setFormTypeValue] = useState<"24Q" | "26Q">(formType);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const formTypeId = useId();
  const errId = useId();
  const ref = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(value)) {
      setError(t("requiredError"));
      ref.current?.focus();
      return;
    }
    setError(null);
    router.push(`/hr/payroll/statutory/challans?period=${encodeURIComponent(value)}&formType=${formTypeValue}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={id}
              ref={ref}
              type="month"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={formTypeId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("formTypeLabel")}
            </label>
            <select
              id={formTypeId}
              value={formTypeValue}
              onChange={(e) => setFormTypeValue(e.target.value as "24Q" | "26Q")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "var(--panel)", color: "var(--ink)" }}
            >
              <option value="24Q">{t("formType24qOption")}</option>
              <option value="26Q">{t("formType26qOption")}</option>
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
