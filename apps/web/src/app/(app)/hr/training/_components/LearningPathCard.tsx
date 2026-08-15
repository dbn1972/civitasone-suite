"use client";

import React from "react";

export interface LearningProgram {
  id: string;
  name: string;
  duration: string;   // e.g. "8h", "3 days"
  mode: "Mandatory" | "Recommended";
  enrollUrl?: string;
  onEnroll?: (id: string) => void;
}

export interface LearningPathCardProps {
  skillGap: string;
  gapPoints: number;        // numeric gap severity
  priority: "high" | "medium" | "low";
  currentLevel: number;
  requiredLevel: number;
  programs: LearningProgram[];
}

const PRIORITY_CONFIG = {
  high:   { label: "High Priority",   bg: "#fef2f2", border: "#fca5a5", pill: "#dc2626", icon: "🔴" },
  medium: { label: "Medium Priority", bg: "#fffbeb", border: "#fcd34d", pill: "#d97706", icon: "🟡" },
  low:    { label: "Low Priority",    bg: "#f0fdf4", border: "#86efac", pill: "#15803d", icon: "🟢" },
};

const MODE_STYLE = {
  Mandatory:   { bg: "#dbeafe", color: "#1d4ed8" },
  Recommended: { bg: "#f1f5f9", color: "#475569" },
};

function LevelBar({ current, required }: { current: number; required: number }) {
  const max = 5;
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {Array.from({ length: max }, (_, i) => {
        const idx = i + 1;
        const filled   = idx <= current;
        const required_ = idx <= required;
        const isGap    = !filled && required_;
        return (
          <div
            key={i}
            style={{
              width: 14, height: 14, borderRadius: 3,
              background: filled ? "#10b981" : isGap ? "#fca5a5" : "#e2e8f0",
              border: `1px solid ${filled ? "#10b981" : isGap ? "#f87171" : "#e2e8f0"}`,
            }}
            title={filled ? `Level ${idx} (achieved)` : isGap ? `Level ${idx} (gap)` : ""}
          />
        );
      })}
      <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>{current}/{required}</span>
    </div>
  );
}

export function LearningPathCard({
  skillGap, gapPoints, priority, currentLevel, requiredLevel, programs,
}: LearningPathCardProps) {
  const pc = PRIORITY_CONFIG[priority];

  return (
    <div
      style={{
        border: `1px solid ${pc.border}`,
        borderLeft: `4px solid ${pc.pill}`,
        borderRadius: 10,
        background: pc.bg,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>{pc.icon}</span>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{skillGap}</p>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
            Skill gap identified — {gapPoints} level{gapPoints !== 1 ? "s" : ""} below requirement
          </p>
        </div>
        <span
          style={{
            flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            background: pc.pill, color: "#fff", borderRadius: 20, padding: "2px 8px",
            letterSpacing: "0.06em",
          }}
        >
          {pc.label}
        </span>
      </div>

      {/* Level bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#475569", fontWeight: 600, minWidth: 80 }}>Proficiency</span>
        <LevelBar current={currentLevel} required={requiredLevel} />
      </div>

      {/* Programs */}
      {programs.length === 0 ? (
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>
          No matching courses in LMS. Contact L&amp;D to add relevant programs.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {programs.map((prog) => {
            const ms = MODE_STYLE[prog.mode];
            return (
              <div
                key={prog.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 7,
                  padding: "8px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: "#1e293b" }}>{prog.name}</span>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, background: ms.bg, color: ms.color,
                        borderRadius: 4, padding: "1px 5px",
                      }}
                    >
                      {prog.mode}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Duration: {prog.duration}</span>
                </div>
                <a
                  href={prog.enrollUrl ?? "#"}
                  onClick={(e) => { if (prog.onEnroll) { e.preventDefault(); prog.onEnroll(prog.id); } }}
                  style={{
                    flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "5px 12px",
                    border: "none", borderRadius: 6, background: "#1d4ed8", color: "#fff",
                    cursor: "pointer", textDecoration: "none", display: "inline-block",
                  }}
                >
                  Enroll
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
