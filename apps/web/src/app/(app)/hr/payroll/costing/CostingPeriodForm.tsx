"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "../../../../_components/ds";
import { PERIOD_PATTERN, isValidPeriod } from "@/lib/payroll/period";

export function CostingPeriodForm({ initialPeriod }: { initialPeriod: string }) {
  const t = useTranslations("costingPeriodForm");
  const tv = useTranslations("hrFormErrors2");
  const router = useRouter();
  const [period, setPeriod] = useState(initialPeriod);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // GAP-PAYROLL-COSTING-06: month must be 01-12 ("2026-13" used to pass).
    if (!isValidPeriod(period)) {
      setError(t("periodFormatError"));
      return;
    }
    setError(null);
    router.push(`/hr/payroll/costing?period=${encodeURIComponent(period.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
      <Field id={fieldId} label={t("periodLabel")} required error={error ? tv("invalidValue") : undefined}>
        <Input
          type="month"
          pattern={PERIOD_PATTERN}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-08"
        />
      </Field>
      <Button type="submit" style={{ minHeight: 44 }}>
        {t("viewReportBtn")}
      </Button>
      {error && (
        <p id={`${fieldId}-err`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {error}
        </p>
      )}
    </form>
  );
}
