"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { humanizeStatus, formatIndianDate } from "@/lib/formatters";

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
  planned:     { bg: "var(--infobg)", color: "var(--info)", dot: "#60a5fa" },
  in_progress: { bg: "#fff7e6", color: "var(--warn)", dot: "#fbbf24" },
  completed:   { bg: "var(--goodbg)", color: "var(--good)", dot: "#4ade80" },
  deferred:    { bg: "var(--bg)", color: "var(--mut)", dot: "var(--mut)" },
  cancelled:   { bg: "var(--badbg)", color: "var(--bad)", dot: "var(--bad)" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high:   "var(--bad)",
  medium: "var(--warn)",
  low:    "var(--good)",
};

function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

function formatDate(s: string): string {
  return formatIndianDate(s);
}

export function DevelopmentPlanTimeline({ activities }: DevelopmentPlanTimelineProps) {
  const t = useTranslations("goals");
  const PRIORITY_LABEL: Record<string, string> = {
    high: t("priorityHigh"),
    medium: t("priorityMedium"),
    low: t("priorityLow"),
  };

  if (activities.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--mut)", fontSize: 14 }}>
        {t("devPlanEmptyMessage")}
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
          insetInlineStart: 15,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--line)",
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
                background: "var(--info)", color: "var(--panel)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, flexShrink: 0,
                boxShadow: "0 0 0 4px var(--panel), 0 0 0 5px var(--line)",
                zIndex: 1, position: "relative",
              }}
            >
              {quarterLabel.split(" ")[0]}
            </div>
            <div>
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{quarterLabel}</span>
            </div>
          </div>

          {/* Activities in this quarter */}
          <div style={{ paddingInlineStart: 52, display: "flex", flexDirection: "column", gap: 8 }}>
            {acts.map((act) => {
              const ss = STATUS_STYLE[act.status] ?? STATUS_STYLE.planned;
              const isPast = new Date(act.plannedDate) < now && act.status === "planned";
              return (
                <div
                  key={act.id}
                  style={{
                    background: "var(--panel)",
                    border: `1px solid ${isPast ? "var(--badbd)" : "var(--line)"}`,
                    borderInlineStart: `3px solid ${PRIORITY_COLOR[act.priority]}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    position: "relative",
                  }}
                >
                  {/* Connector dot */}
                  <div
                    style={{
                      position: "absolute",
                      insetInlineStart: -38,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: ss.dot,
                      border: "2px solid var(--panel)",
                      zIndex: 1,
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14 }} aria-hidden="true">{TYPE_ICON[act.type] ?? "📌"}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{act.title}</span>
                        <span
                          style={{
                            fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.color,
                            borderRadius: 20, padding: "1px 6px",
                          }}
                        >
                          {/* GAP-HR-GOALS-06: was act.status.replace('_',' ') --
                              read as data straight from a DB enum with no
                              capitalisation; humanizeStatus (lib/formatters.ts)
                              is the same helper other HR screens already use
                              for this exact "enum -> display label" step. */}
                          {humanizeStatus(act.status)}
                        </span>
                        {isPast && (
                          <span style={{ fontSize: 11, background: "var(--badbg)", color: "var(--bad)", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                            {t("overdueLabel")}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--mut)" }}>
                          {formatDate(act.plannedDate)}
                          {act.durationDays ? ` · ${act.durationDays}d` : ""}
                        </span>
                        {act.skillTargeted && (
                          <span style={{ fontSize: 11, color: "var(--mut)" }}>
                            {t("targetsLabel")} <strong>{act.skillTargeted}</strong>
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
                      {/* GAP-HR-GOALS-06: was the raw enum word ("high"/"medium"/
                          "low") relying on CSS text-transform:uppercase alone
                          for presentation -- translated now, same as every
                          other status/label on this page. */}
                      {PRIORITY_LABEL[act.priority] ?? act.priority}
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
