"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

interface PipelineOption {
  id: string;
  name: string;
}

/**
 * Narrows the forecast to a single pipeline by round-tripping through the
 * server: the total has to be recomputed from the pipeline's own stage
 * probabilities, so filtering client-side would report the wrong number.
 */
export function PipelineFilter({ pipelines, pipelinesFailed = false }: { pipelines: PipelineOption[]; pipelinesFailed?: boolean }) {
  const t = useTranslations("crmForecastPeriod");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const selected = searchParams.get("pipelineId") ?? "";

  // GAP-CRM-FORECAST-02: when the pipelines fetch fails the filter must not silently
  // vanish (returning null) — show a disabled control that says so, so the forecast
  // is understood to be across all pipelines rather than a filter having disappeared.
  if (pipelinesFailed) {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#475569" }}>{t("pipelineLabel")}</span>
        <select disabled aria-label={t("pipelineFilterAria")} aria-describedby="pipeline-filter-note">
          <option>{t("pipelinesUnavailable")}</option>
        </select>
        <span id="pipeline-filter-note" role="note" style={{ fontSize: 12, color: "#b45309" }}>
          {t("pipelinesLoadFailedNote")}
        </span>
      </label>
    );
  }

  // Genuinely empty (loaded, but no pipelines configured): say so rather than hide.
  if (pipelines.length === 0) {
    return (
      <p role="note" style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
        {t("noPipelinesNote")}
      </p>
    );
  }

  const onChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("pipelineId", value);
    else next.delete("pipelineId");
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/crm/forecast?${qs}` : "/crm/forecast");
    });
  };

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 13, color: "#475569" }}>Pipeline</span>
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter forecast by pipeline"
      >
        <option value="">All pipelines</option>
        {pipelines.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {pending && <span style={{ fontSize: 12, color: "#64748b" }}>Recalculating…</span>}
    </label>
  );
}
