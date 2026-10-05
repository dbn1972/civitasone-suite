"use client";

/**
 * GAP-CRM-VOICE-OF-CUSTOMER-01: the Voice of Citizen summary used to call the
 * loader with no window at all, while the "Partial window" card told the reader
 * to "narrow the period" — advice with no control to follow it. This is that
 * control. It writes `from`/`to` (ISO yyyy-mm-dd) into the URL via
 * router.replace, which re-runs the server page's loader with those params
 * (the aggregate is recomputed server-side — see getCrmSentimentSummary); it
 * never narrows a client-held page of rows.
 */
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "../../../_components/ds";

/** yyyy-mm-dd for a date N days before today (today when days === 0), in local time. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Keys are stable ids; the visible labels are resolved with t() at render time.
const PRESETS: Record<string, number | null> = {
  days7: 7,
  days30: 30,
  days90: 90,
  all: null,
};

/** Map the current from/to back to a preset label so the control reflects the URL. */
function activeLabel(from?: string, to?: string): string {
  if (!from && !to) return "all";
  const today = isoDaysAgo(0);
  if (to && to !== today) return "custom";
  for (const [label, days] of Object.entries(PRESETS)) {
    if (days !== null && from === isoDaysAgo(days)) return label;
  }
  return "custom";
}

export function PeriodFilter({ from, to }: { from?: string; to?: string }) {
  const t = useTranslations("crmPeriodFilter");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeLabel(from, to);
  const keys = [...Object.keys(PRESETS), ...(active === "custom" ? ["custom"] : [])];
  const options = keys.map((k) => t(`preset.${k}`));

  function apply(label: string) {
    const key = keys.find((k) => t(`preset.${k}`) === label);
    if (!key || key === "custom") return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const days = PRESETS[key];
    if (days === null) {
      params.delete("from");
      params.delete("to");
    } else {
      params.set("from", isoDaysAgo(days));
      params.set("to", isoDaysAgo(0));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div aria-label={t("ariaLabel")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("period")}</span>
      <Segmented options={options} value={t(`preset.${active}`)} onChange={apply} />
    </div>
  );
}
