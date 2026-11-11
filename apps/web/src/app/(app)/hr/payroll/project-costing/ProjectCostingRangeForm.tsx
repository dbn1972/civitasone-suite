"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "../../../../_components/ds";
import { PERIOD_PATTERN, isValidPeriod } from "@/lib/payroll/period";

export function ProjectCostingRangeForm({ initialFrom, initialTo }: { initialFrom: string; initialTo: string }) {
  const t = useTranslations("projectCosting");
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState<string | null>(null);
  const fromId = useId();
  const toId = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPeriod(from) || !isValidPeriod(to)) return setError(t("periodFormatError"));
    if (from > to) return setError(t("periodOrderError"));
    setError(null);
    router.push(`/hr/payroll/project-costing?from=${encodeURIComponent(from.trim())}&to=${encodeURIComponent(to.trim())}`);
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
      <Field id={fromId} label={t("periodFromLabel")} required>
        <Input type="month" pattern={PERIOD_PATTERN} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2026-04" />
      </Field>
      <Field id={toId} label={t("periodToLabel")} required>
        <Input type="month" pattern={PERIOD_PATTERN} value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026-09" />
      </Field>
      <Button type="submit" style={{ minHeight: 44 }}>{t("viewReportBtn")}</Button>
      {error && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{error}</p>}
    </form>
  );
}
