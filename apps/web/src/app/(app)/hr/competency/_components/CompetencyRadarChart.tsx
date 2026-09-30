"use client";

import React from "react";
import { useTranslations } from "next-intl";

export interface CompetencyScore {
  label: string;
  current: number;  // 0–5
  required: number; // 0–5
}

export interface CompetencyRadarChartProps {
  scores: CompetencyScore[];
  title?: string;
  size?: number;
}

const DEFAULT_COMPETENCIES: CompetencyScore[] = [
  { label: "Domain Knowledge", current: 0, required: 4 },
  { label: "Leadership",       current: 0, required: 3 },
  { label: "Communication",    current: 0, required: 4 },
  { label: "Problem Solving",  current: 0, required: 4 },
  { label: "Team Work",        current: 0, required: 5 },
  { label: "Integrity",        current: 0, required: 5 },
];

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function pointsToPath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") + " Z";
}

export function CompetencyRadarChart({
  scores = DEFAULT_COMPETENCIES,
  title,
  size = 340,
}: CompetencyRadarChartProps) {
  const t = useTranslations("competency");
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.34;
  const MAX_VAL = 5;
  const n = scores.length;
  const levels = [1, 2, 3, 4, 5];
  const startAngle = -Math.PI / 2; // top

  function angleFor(i: number) {
    return startAngle + (2 * Math.PI * i) / n;
  }

  // Polygon points for a given value series
  function buildPolygon(values: number[]): { x: number; y: number }[] {
    return values.map((v, i) => {
      const r = (v / MAX_VAL) * maxR;
      return polarToCartesian(cx, cy, r, angleFor(i));
    });
  }

  const requiredPts = buildPolygon(scores.map((s) => s.required));
  const currentPts  = buildPolygon(scores.map((s) => s.current));

  // Axis endpoints (tips)
  const axisEndpoints = scores.map((_, i) => polarToCartesian(cx, cy, maxR, angleFor(i)));

  // Label positions (slightly further out)
  const labelR = maxR + 22;
  const labelPts = scores.map((_, i) => polarToCartesian(cx, cy, labelR, angleFor(i)));

  function textAnchor(pt: { x: number }): "start" | "middle" | "end" {
    if (pt.x < cx - 10) return "end";
    if (pt.x > cx + 10) return "start";
    return "middle";
  }

  // GAP-HR-COMPETENCY-05: this chart's own summary, built from the same data
  // driving the SVG, doubles as the accessible name (role="img" + aria-label
  // below) so a screen-reader user gets the actual values, not just "chart".
  const ariaSummary = t("radarAriaLabel", {
    items: scores.map((s) => `${s.label} ${s.current}/${s.required}`).join(", "),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
      {title && (
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--ink, #1e293b)" }}>{title}</p>
      )}
      {/* GAP-HR-COMPETENCY-03: width/height used to be fixed SVG attributes
          (340x340), which never shrank below that on a narrow phone
          viewport -- only the score TABLE below had its own overflow
          wrapper. Switching to a CSS-driven width (viewBox unchanged) lets
          the whole chart scale down instead. */}
      <svg
        style={{ width: "100%", maxWidth: size, height: "auto" }}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaSummary}
      >
        {/* Concentric rings */}
        {levels.map((lvl) => {
          const pts = Array.from({ length: n }, (_, i) =>
            polarToCartesian(cx, cy, (lvl / MAX_VAL) * maxR, angleFor(i))
          );
          return (
            <polygon
              key={lvl}
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--line, #e2e8f0)"
              strokeWidth={1}
            />
          );
        })}

        {/* Level labels (1–5) on first axis */}
        {levels.map((lvl) => {
          const r   = (lvl / MAX_VAL) * maxR;
          const pt  = polarToCartesian(cx, cy, r, angleFor(0));
          return (
            // `--mut` (#667085) is ~4.55:1 against the plain grid background here,
            // but the innermost labels sit right at the polygon-fill/grid-line
            // edge (hand-measured worst case ~4.1:1 there) -- axe itself can't
            // score this (short single-digit text content), but the margin is
            // genuinely too thin. `--ink2` (#475569, ~6.9:1 here) matches what
            // the axis category labels below already use.
            <text key={lvl} x={pt.x + 4} y={pt.y} style={{ fontSize: 9, fill: "var(--ink2)" }} aria-hidden="true">
              {lvl}
            </text>
          );
        })}

        {/* Axis spokes */}
        {axisEndpoints.map((pt, i) => (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={pt.x} y2={pt.y}
            stroke="var(--line, #e2e8f0)"
            strokeWidth={1}
          />
        ))}

        {/* Required polygon */}
        <path
          d={pointsToPath(requiredPts)}
          fill="rgba(59,130,246,0.08)"
          stroke="var(--info, #3b82f6)"
          strokeWidth={2}
          strokeDasharray="5 3"
        />

        {/* Current polygon */}
        <path
          d={pointsToPath(currentPts)}
          fill="rgba(16,185,129,0.15)"
          stroke="var(--good, #10b981)"
          strokeWidth={2.5}
        />

        {/* Data points — current */}
        {currentPts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={4} fill="var(--good, #10b981)" stroke="var(--panel, #fff)" strokeWidth={1.5} />
        ))}

        {/* Axis labels */}
        {labelPts.map((pt, i) => (
          <text
            key={i}
            x={pt.x}
            y={pt.y + 4}
            textAnchor={textAnchor(pt)}
            aria-hidden="true"
            style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink2, #475569)" }}
          >
            {scores[i].label}
          </text>
        ))}
      </svg>

      {/* Legend + score table */}
      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width={20} height={4} aria-hidden="true"><line x1={0} y1={2} x2={20} y2={2} stroke="var(--good, #10b981)" strokeWidth={2.5} /></svg>
          <span style={{ fontSize: 12, color: "var(--good)", fontWeight: 600 }}>{t("radarLegendCurrent")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width={20} height={4} aria-hidden="true"><line x1={0} y1={2} x2={20} y2={2} stroke="var(--info, #3b82f6)" strokeWidth={2} strokeDasharray="5 3" /></svg>
          <span style={{ fontSize: 12, color: "var(--info)", fontWeight: 600 }}>{t("radarLegendRequired")}</span>
        </div>
      </div>

      {/* Scores table */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg, #f8fafc)" }}>
              <th style={{ textAlign: "start", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--ink, #1e293b)" }}>{t("colCompetency")}</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--good)" }}>{t("radarLegendCurrent")}</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--info)" }}>{t("radarLegendRequired")}</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--ink, #1e293b)" }}>{t("radarColGap")}</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, i) => {
              const gap = s.required - s.current;
              // GAP-HR-COMPETENCY-03: both bare-hex fallbacks replaced with
              // the same token+fallback pattern already used a few lines
              // above (var(--good,...) etc.) -- `#dc2626`/odd-row `#f8fafc`
              // were the only two colour values in this file with no token
              // at all, so they didn't move with the rest of the page in
              // dark mode.
              const gapColor = gap <= 0 ? "var(--good, #15803d)" : gap === 1 ? "var(--warn, #d97706)" : "var(--bad, #dc2626)";
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "var(--panel, #fff)" : "var(--bg, #f8fafc)" }}>
                  <td style={{ padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", fontWeight: 500 }}>{s.label}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--good)", fontWeight: 700 }}>{s.current}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: "var(--info)", fontWeight: 700 }}>{s.required}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid var(--line, #e2e8f0)", color: gapColor, fontWeight: 700 }}>
                    {gap > 0 ? `−${gap}` : gap < 0 ? `+${Math.abs(gap)}` : "✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
