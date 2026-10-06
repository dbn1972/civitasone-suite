"use client";

/**
 * Accessible bar chart (WCAG 2.2 AA).
 *
 * GAP-ANALYTICS-QUERIES-05: the figure used to be `role="img"` with a long
 * `aria-label` AND an sr-only <dl> nested inside. Children of a `role="img"`
 * node are presentational, so the structured <dl> was NEVER exposed to screen
 * readers — only the single unbounded label string was. We now drop
 * `role="img"`/`aria-label` from the figure so its real descendants (the
 * visible caption and the sr-only description list) ARE exposed to AT, and the
 * decorative bar graphics are the only `aria-hidden` part. The <dl> is the
 * canonical text alternative; the caption is visible to everyone.
 *
 * GAP-ANALYTICS-QUERIES-04: values are formatted by the caller via
 * `formatValue` (money → ₹ paise-safe), not a bare toLocaleString, and the
 * sr-only and visible numbers now use the SAME formatter (no "123 paise" vs
 * "123paise" spacing drift).
 */
import { useMemo } from "react";

export type BarDatum = { label: string; value: number };

export function AccessibleBarChart({
  title,
  data,
  formatValue,
}: {
  title: string;
  data: BarDatum[];
  /** Format a raw numeric value for display (e.g. paise → "₹123.45"). */
  formatValue?: (value: number) => string;
}) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
  const fmt = useMemo(
    () => formatValue ?? ((v: number) => v.toLocaleString("en-IN")),
    [formatValue],
  );

  if (data.length === 0) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#475569" }}>
        No data points to chart for {title}.
      </p>
    );
  }

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
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
              {fmt(d.value)}
            </span>
          </div>
        ))}
      </div>

      {/* Text alternative: the same data as a structured description list,
          visually hidden but exposed to assistive tech (NOT nested under a
          role="img", so AT actually announces each dt/dd pair). */}
      <dl className="sr-only">
        {data.map((d) => (
          <div key={d.label}>
            <dt>{d.label}</dt>
            <dd>{fmt(d.value)}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
