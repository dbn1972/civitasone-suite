"use client";

import React from "react";
import { useTranslations } from "next-intl";

export interface CategoryScore {
  // GAP-HR-GOALS-03: was a closed union of the four made-up display buckets
  // (Performance/Development/Behavioural/Organisational) that never matched
  // the real API category enum (individual|team|organization,
  // pulse-routes.ts's goalCreateSchema) -- goals/page.tsx now builds these
  // from the real enum and passes an already-translated label string, so
  // this just needs to be a string.
  label: string;
  total: number;
  achieved: number;
  color: string;
}

export interface GoalsProgressRingProps {
  categories: CategoryScore[];
  overallScore: number; // 0–100
}

function Ring({ pct, color, label, size = 88 }: { pct: number; color: string; label: string; size?: number }) {
  const r  = (size / 2) - 8;
  const cx = size / 2;
  const cy = size / 2;
  const c  = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${pct}%`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line, #e2e8f0)" strokeWidth={7} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text
        x={cx} y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        aria-hidden="true"
        style={{ fontSize: 13, fontWeight: 700, fill: color }}
      >
        {pct}%
      </text>
    </svg>
  );
}

function OverallRing({ score, overallLabel, scoreLabel }: { score: number; overallLabel: string; scoreLabel: string }) {
  const r  = 52;
  const cx = 68;
  const cy = 68;
  const c  = 2 * Math.PI * r;
  const dash = Math.min(score / 100, 1) * c;
  // GAP-HR-GOALS-05: this was the one bare hex value in the file (every
  // other colour already went through var(--token, #fallback)) -- the "bad"
  // tone token used everywhere else in this same HR tree (e.g.
  // GoalTrackerCard's own "behind" status colour) is `--bad`.
  const color = score >= 80 ? "var(--good, #15803d)" : score >= 60 ? "var(--warn, #d97706)" : "var(--bad, #dc2626)";
  return (
    <svg width={136} height={136} viewBox="0 0 136 136" role="img" aria-label={`${overallLabel}: ${score}%`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line, #e2e8f0)" strokeWidth={10} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 8} textAnchor="middle" aria-hidden="true" style={{ fontSize: 26, fontWeight: 800, fill: color }}>{score}%</text>
      <text x={cx} y={cy + 12} textAnchor="middle" aria-hidden="true" style={{ fontSize: 11, fill: "var(--mut, #64748b)", fontWeight: 500 }}>{overallLabel}</text>
      <text x={cx} y={cy + 24} textAnchor="middle" aria-hidden="true" style={{ fontSize: 11, fill: "var(--mut, #64748b)", fontWeight: 500 }}>{scoreLabel}</text>
    </svg>
  );
}

export function GoalsProgressRing({ categories, overallScore }: GoalsProgressRingProps) {
  const t = useTranslations("goals");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        flexWrap: "wrap",
        padding: "16px 20px",
        background: "var(--panel, #fff)",
        border: "1px solid var(--line, #e2e8f0)",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}
    >
      {/* Overall ring */}
      <div style={{ flexShrink: 0 }}>
        <OverallRing score={overallScore} overallLabel={t("ringOverallLabel")} scoreLabel={t("ringScoreLabel")} />
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 100, background: "var(--line, #e2e8f0)", flexShrink: 0 }} />

      {/* Category rings */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", flex: 1 }}>
        {categories.map((cat) => {
          const pct = cat.total === 0 ? 0 : Math.round((cat.achieved / cat.total) * 100);
          return (
            <div key={cat.label} style={{ textAlign: "center", minWidth: 80 }}>
              <Ring pct={pct} color={cat.color} label={cat.label} />
              <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "var(--ink2, #475569)" }}>
                {cat.label}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--mut)" }}>
                {t("ringGoalsCount", { achieved: cat.achieved, total: cat.total })}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
