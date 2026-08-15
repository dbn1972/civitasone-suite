"use client";

import React from "react";

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

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      {title && (
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{title}</p>
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Competency radar chart">
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
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          );
        })}

        {/* Level labels (1–5) on first axis */}
        {levels.map((lvl) => {
          const r   = (lvl / MAX_VAL) * maxR;
          const pt  = polarToCartesian(cx, cy, r, angleFor(0));
          return (
            <text key={lvl} x={pt.x + 4} y={pt.y} style={{ fontSize: 9, fill: "#94a3b8" }}>
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
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* Required polygon */}
        <path
          d={pointsToPath(requiredPts)}
          fill="rgba(59,130,246,0.08)"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="5 3"
        />

        {/* Current polygon */}
        <path
          d={pointsToPath(currentPts)}
          fill="rgba(16,185,129,0.15)"
          stroke="#10b981"
          strokeWidth={2.5}
        />

        {/* Data points — current */}
        {currentPts.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={4} fill="#10b981" stroke="#fff" strokeWidth={1.5} />
        ))}

        {/* Axis labels */}
        {labelPts.map((pt, i) => (
          <text
            key={i}
            x={pt.x}
            y={pt.y + 4}
            textAnchor={textAnchor(pt)}
            style={{ fontSize: 11, fontWeight: 600, fill: "#475569" }}
          >
            {scores[i].label}
          </text>
        ))}
      </svg>

      {/* Legend + score table */}
      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#10b981" strokeWidth={2.5} /></svg>
          <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>Current</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" /></svg>
          <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>Required</span>
        </div>
      </div>

      {/* Scores table */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th style={{ textAlign: "left", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#1e293b" }}>Competency</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#10b981" }}>Current</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#3b82f6" }}>Required</th>
              <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#1e293b" }}>Gap</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, i) => {
              const gap = s.required - s.current;
              const gapColor = gap <= 0 ? "#15803d" : gap === 1 ? "#d97706" : "#dc2626";
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                  <td style={{ padding: "6px 10px", border: "1px solid #e2e8f0", fontWeight: 500 }}>{s.label}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#10b981", fontWeight: 700 }}>{s.current}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: "#3b82f6", fontWeight: 700 }}>{s.required}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #e2e8f0", color: gapColor, fontWeight: 700 }}>
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
