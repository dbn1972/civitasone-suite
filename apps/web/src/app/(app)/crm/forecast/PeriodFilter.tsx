"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { localizedPeriodLabel, periodOptions } from "./period";

/**
 * Forecast period picker (GAP-CRM-FORECAST-03). Narrows the weighted forecast to
 * a financial-year quarter (or whole FY) by round-tripping through the server —
 * the total is recomputed from deals whose expected close date falls in the
 * window, so filtering client-side would report the wrong number.
 */
export function PeriodFilter() {
  const t = useTranslations("crmForecastPeriod");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const selected = searchParams.get("period") ?? "";
  const options = periodOptions();

  const onChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("period", value);
    else next.delete("period");
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/crm/forecast?${qs}` : "/crm/forecast");
    });
  };

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 13, color: "#475569" }}>{t("period")}</span>
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("filterAria")}
      >
        <option value="">{t("allOpenDealsOption")}</option>
        {options.map((p) => (
          <option key={p.key} value={p.key}>{localizedPeriodLabel(p, (k, v) => t(k, v))}</option>
        ))}
      </select>
      {pending && <span style={{ fontSize: 12, color: "#64748b" }}>{t("recalculating")}</span>}
    </label>
  );
}
