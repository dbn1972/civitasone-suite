"use client";

import React from "react";

export interface CategoryScore {
  label: "Performance" | "Development" | "Behavioural" | "Organisational";
  total: number;
  achieved: number;
  color: string;
}

export interface GoalsProgressRingProps {
  categories: CategoryScore[];
  overallScore: number; // 0–100
}

const R = 36;
const CX = 44;
const CY = 44;
const CIRCUMFERENCE = 2 * Math.PI * R;

function Ring({ pct, color, size = 88 }: { pct: number; color: string; size?: number }) {
  const r  = (size / 2) - 8;
  const cx = size / 2;
  const cy = size / 2;
  const c  = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={7} />
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
        style={{ fontSize: 13, fontWeight: 700, fill: color }}
      >
        {pct}%
      </text>
    </svg>
  );
}

function OverallRing({ score }: { score: number }) {
  const r  = 52;
  const cx = 68;
  const cy = 68;
  const c  = 2 * Math.PI * r;
  const dash = Math.min(score / 100, 1) * c;
  const color = score >= 80 ? "#15803d" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <svg width={136} height={136} viewBox="0 0 136 136">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontSize: 26, fontWeight: 800, fill: color }}>{score}%</text>
      <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}>Overall</text>
      <text x={cx} y={cy + 24} textAnchor="middle" style={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}>Score</text>
    </svg>
  );
}

export function GoalsProgressRing({ categories, overallScore }: GoalsProgressRingProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        flexWrap: "wrap",
        padding: "16px 20px",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}
    >
      {/* Overall ring */}
      <div style={{ flexShrink: 0 }}>
        <OverallRing score={overallScore} />
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 100, background: "#e2e8f0", flexShrink: 0 }} />

      {/* Category rings */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", flex: 1 }}>
        {categories.map((cat) => {
          const pct = cat.total === 0 ? 0 : Math.round((cat.achieved / cat.total) * 100);
          return (
            <div key={cat.label} style={{ textAlign: "center", minWidth: 80 }}>
              <Ring pct={pct} color={cat.color} />
              <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "#475569" }}>
                {cat.label}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>
                {cat.achieved}/{cat.total} goals
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
