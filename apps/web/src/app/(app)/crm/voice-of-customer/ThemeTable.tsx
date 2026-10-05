"use client";
import { useTranslations } from "next-intl";import { DataTable, StatusPill } from "../../../_components/ds";
import type { PillVariant } from "../../../_components/ds/StatusPill";
import { themeLabel, type RankedTheme } from "./voc";

type ThemeRow = {
  theme: string;
  label: string;
  count: number;
  negativeCount: number;
  sharePct: number;
  negativePct: number;
};

/**
 * A theme that is mostly negative needs attention regardless of how often it
 * appears. GAP-CRM-VOICE-OF-CUSTOMER-03: the three bands used to carry
 * three labels ("Needs attention"/"Watch"/"Healthy") that are not keys in the
 * shared StatusPill STATUS_MAP, so every row fell back to the same neutral
 * "info" blue — a 64% negative theme looked identical to a 7% one. Map each
 * band to an explicit pill variant (bad/warn/good) so the colour carries the
 * signal, keeping the human label. This reuses the shared pill's existing
 * tones rather than editing the app-wide map (which other screens depend on).
 */
export function toneOf(negativePct: number): { variant: PillVariant; label: string } {
  if (negativePct >= 60) return { variant: "bad", label: "Needs attention" };
  if (negativePct >= 30) return { variant: "warn", label: "Watch" };
  return { variant: "good", label: "Healthy" };
}

export function ThemeTable({ themes, canExport = true }: { themes: RankedTheme[]; canExport?: boolean }) {
  const t = useTranslations("crmThemeTable");
  const toneKey = { bad: "toneNeedsAttention", warn: "toneWatch", good: "toneHealthy" } as const;
  const rows: ThemeRow[] = themes.map((t) => ({
    theme: t.theme,
    label: themeLabel(t.theme),
    count: t.count,
    negativeCount: t.negativeCount,
    sharePct: t.sharePct,
    negativePct: t.negativePct,
  }));

  return (
    <DataTable<ThemeRow>
      columns={[
        { key: "label", label: "Feedback Theme" },
        {
          key: "negativePct",
          label: "Tone",
          render: (row) => {
            const tone = toneOf(row.negativePct);
            return <StatusPill status={tone.label} label={t(toneKey[tone.variant as "bad" | "warn" | "good"])} variant={tone.variant} />;
          },
        },
        {
          key: "count",
          label: "Interactions",
          align: "right",
          render: (row) => row.count.toLocaleString("en-IN"),
        },
        {
          key: "negativeCount",
          label: "Of which negative",
          align: "right",
          render: (row) =>
            `${row.negativeCount.toLocaleString("en-IN")} (${row.negativePct}%)`,
        },
        {
          key: "sharePct",
          label: "Share of all interactions",
          align: "right",
          render: (row) => `${row.sharePct}%`,
        },
      ]}
      rows={rows}
      sortable
      exportable={canExport}
      exportFilename="crm-voice-of-citizen-themes"
      emptyIcon="▣"
      emptyTitle="Nothing scored yet"
      emptyMessage="Themes appear once interactions have been logged against contacts and engagements. Every note, call and complaint is scored automatically."
      emptyAction={
        <a className="btn primary" href="/crm/activities">
          Log an interaction
        </a>
      }
    />
  );
}
