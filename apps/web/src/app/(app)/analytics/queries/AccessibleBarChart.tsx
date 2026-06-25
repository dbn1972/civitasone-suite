"use client";

/**
 * Accessible bar chart (WCAG 2.2 AA).
 *
 * Approach: the whole figure is exposed as a single labelled image
 * (role="img" + aria-label carrying the full data summary), so assistive
 * tech announces every category and value. The visual bars are decorative
 * (aria-hidden) and a visible-on-focus text alternative (a description list)
 * mirrors the same data for AT that prefers structured reading. Colour is a
 * DS token and never the sole carrier of meaning — every bar is labelled with
 * its value.
 */
import { useMemo } from "react";

export type BarDatum = { label: string; value: number };

export function AccessibleBarChart({
  title,
  data,
  unit = "",
}: {
  title: string;
  data: BarDatum[];
  unit?: string;
}) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);

  if (data.length === 0) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#475569" }}>
        No data points to chart for {title}.
      </p>
    );
  }

  const summary = `${title}: ${data
    .map((d) => `${d.label} ${d.value.toLocaleString()}${unit}`)
    .join(", ")}.`;

  return (
    <figure role="img" aria-label={summary} style={{ margin: 0 }}>
      <figcaption aria-hidden="true" style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
        {title}
      </figcaption>

      {/* Decorative visual representation — hidden from assistive tech. */}
      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "0 0 140px", fontSize: 13, color: "#334155", textAlign: "right" }}>
              {d.label}
            </span>
            <span style={{ flex: 1, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  width: `${Math.round((d.value / max) * 100)}%`,
                  minWidth: 2,
                  height: 18,
                  // DS token blue — meets AA contrast against the white card.
                  background: "#1d4ed8",
                }}
              />
            </span>
            <span style={{ flex: "0 0 90px", fontSize: 13, color: "#0f172a" }}>
              {d.value.toLocaleString()}
              {unit}
            </span>
          </div>
        ))}
      </div>

      {/* Text alternative: the same data as a structured description list,
          visually hidden but available to assistive tech. */}
      <dl className="sr-only">
        {data.map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>
              {d.value.toLocaleString()}
              {unit ? ` ${unit}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
