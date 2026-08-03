"use client";
import { DataTable, StatusPill } from "../../../_components/ds";
import { themeLabel, type RankedTheme } from "./voc";

type ThemeRow = {
  theme: string;
  label: string;
  count: number;
  negativeCount: number;
  sharePct: number;
  negativePct: number;
};

/** A theme that is mostly negative needs attention regardless of how often it appears. */
function toneOf(negativePct: number): string {
  if (negativePct >= 60) return "Needs attention";
  if (negativePct >= 30) return "Watch";
  return "Healthy";
}

export function ThemeTable({ themes }: { themes: RankedTheme[] }) {
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
        { key: "label", label: "Theme" },
        {
          key: "negativePct",
          label: "Tone",
          render: (row) => <StatusPill status={toneOf(row.negativePct)} />,
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
      exportable
      exportFilename="crm-voice-of-customer-themes"
      emptyIcon="💬"
      emptyTitle="Nothing scored yet"
      emptyMessage="Themes appear once interactions have been logged against contacts and deals. Every note, call and complaint is scored automatically."
      emptyAction={
        <a className="btn primary" href="/crm/activities">
          Log an interaction
        </a>
      }
    />
  );
}
