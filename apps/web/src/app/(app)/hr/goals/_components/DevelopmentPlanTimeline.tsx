"use client";

import React from "react";

export interface DevActivity {
  id: string;
  title: string;
  type: "training" | "project" | "mentoring" | "self_study" | "certification" | "job_rotation" | "other";
  plannedDate: string; // YYYY-MM-DD
  durationDays?: number;
  status: "planned" | "in_progress" | "completed" | "deferred" | "cancelled";
  skillTargeted?: string;
  priority: "high" | "medium" | "low";
}

export interface DevelopmentPlanTimelineProps {
  activities: DevActivity[];
}

const TYPE_ICON: Record<string, string> = {
  training:    "📚",
  project:     "📋",
  mentoring:   "🤝",
  self_study:  "📖",
  certification: "🏅",
  job_rotation: "🔄",
  other:       "📌",
};

const STATUS_STYLE: Record<string, { bg: string; color: string; dot: string }> = {
  planned:     { bg: "#eff6ff", color: "#1d4ed8", dot: "#60a5fa" },
  in_progress: { bg: "#fff7e6", color: "#d97706", dot: "#fbbf24" },
  completed:   { bg: "#f0fdf4", color: "#15803d", dot: "#4ade80" },
  deferred:    { bg: "#f8fafc", color: "#64748b", dot: "#94a3b8" },
  cancelled:   { bg: "#fef2f2", color: "#dc2626", dot: "#f87171" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high:   "#dc2626",
  medium: "#d97706",
  low:    "#15803d",
};

function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

function formatDate(s: string): string {
  const d = new Date(s);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function DevelopmentPlanTimeline({ activities }: DevelopmentPlanTimelineProps) {
  if (activities.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
        No development activities planned. Add activities from the Development Plan section.
      </div>
    );
  }

  // Group by quarter label
  const now  = new Date();
  const byQ: Record<string, DevActivity[]> = {};
  const sorted = [...activities].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));

  for (const act of sorted) {
    const d = new Date(act.plannedDate);
    const yr = d.getFullYear();
    const q  = getQuarter(d);
    const key = `Q${q} ${yr}`;
    (byQ[key] ??= []).push(act);
  }

  const quarters = Object.entries(byQ);

  return (
    <div style={{ position: "relative", padding: "4px 0" }}>
      {/* Vertical spine */}
      <div
        style={{
          position: "absolute",
          left: 15,
          top: 0,
          bottom: 0,
          width: 2,
          background: "#e2e8f0",
          zIndex: 0,
        }}
      />

      {quarters.map(([quarterLabel, acts]) => (
        <div key={quarterLabel} style={{ marginBottom: 24 }}>
          {/* Quarter marker */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, position: "relative" }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "#1d4ed8", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, flexShrink: 0,
                boxShadow: "0 0 0 4px #fff, 0 0 0 5px #e2e8f0",
                zIndex: 1, position: "relative",
              }}
            >
              {quarterLabel.split(" ")[0]}
            </div>
            <div>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{quarterLabel}</span>
            </div>
          </div>

          {/* Activities in this quarter */}
          <div style={{ paddingLeft: 52, display: "flex", flexDirection: "column", gap: 8 }}>
            {acts.map((act) => {
              const ss = STATUS_STYLE[act.status] ?? STATUS_STYLE.planned;
              const isPast = new Date(act.plannedDate) < now && act.status === "planned";
              return (
                <div
                  key={act.id}
                  style={{
                    background: "#fff",
                    border: `1px solid ${isPast ? "#fca5a5" : "#e2e8f0"}`,
                    borderLeft: `3px solid ${PRIORITY_COLOR[act.priority]}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    position: "relative",
                  }}
                >
                  {/* Connector dot */}
                  <div
                    style={{
                      position: "absolute",
                      left: -38,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: ss.dot,
                      border: "2px solid #fff",
                      zIndex: 1,
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14 }}>{TYPE_ICON[act.type] ?? "📌"}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{act.title}</span>
                        <span
                          style={{
                            fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color,
                            borderRadius: 20, padding: "1px 6px",
                          }}
                        >
                          {act.status.replace("_", " ")}
                        </span>
                        {isPast && (
                          <span style={{ fontSize: 11, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                            Overdue
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {formatDate(act.plannedDate)}
                          {act.durationDays ? ` · ${act.durationDays}d` : ""}
                        </span>
                        {act.skillTargeted && (
                          <span style={{ fontSize: 11, color: "#64748b" }}>
                            Targets: <strong>{act.skillTargeted}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        color: PRIORITY_COLOR[act.priority], letterSpacing: "0.08em",
                      }}
                    >
                      {act.priority}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
