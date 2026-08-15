"use client";

import React, { useState } from "react";

export type GoalStatus = "active" | "on_track" | "at_risk" | "behind" | "achieved" | "completed";
export type CascadeLevel = "org" | "dept" | "individual";

export interface GoalTrackerCardProps {
  id: string;
  title: string;
  description?: string;
  targetMetric?: string;
  progress: number;          // 0–100
  status: GoalStatus;
  category: string;
  dueDate?: string | null;
  cascadeLevel?: CascadeLevel;
  parentGoalTitle?: string;
  onCheckin?: (id: string, progress: number, note: string) => void;
  onEdit?: (id: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  on_track:  { label: "On Track",  bg: "#e6f7f0", color: "#15803d" },
  active:    { label: "On Track",  bg: "#e6f7f0", color: "#15803d" },
  at_risk:   { label: "At Risk",   bg: "#fff7e6", color: "#d97706" },
  behind:    { label: "Behind",    bg: "#fee2e2", color: "#dc2626" },
  achieved:  { label: "Achieved",  bg: "#eff6ff", color: "#1d4ed8" },
  completed: { label: "Achieved",  bg: "#eff6ff", color: "#1d4ed8" },
};

const CASCADE_CONFIG: Record<CascadeLevel, { label: string; bg: string }> = {
  org:        { label: "Org",        bg: "#e0e7ff" },
  dept:       { label: "Dept",       bg: "#fce7f3" },
  individual: { label: "Individual", bg: "#f0fdf4" },
};

function daysLeft(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function DueDateChip({ dueDate }: { dueDate: string }) {
  const days = daysLeft(dueDate);
  const overdue  = days < 0;
  const urgent   = days >= 0 && days <= 7;
  const bg    = overdue ? "#fee2e2" : urgent ? "#fff7e6" : "#f1f5f9";
  const color = overdue ? "#dc2626" : urgent ? "#d97706" : "#475569";
  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
    ? "Due today"
    : `${days}d left`;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, background: bg, color, borderRadius: 4, padding: "2px 6px" }}>
      {label}
    </span>
  );
}

export function GoalTrackerCard({
  id, title, description, targetMetric, progress, status,
  category, dueDate, cascadeLevel = "individual", parentGoalTitle, onCheckin, onEdit,
}: GoalTrackerCardProps) {
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinProgress, setCheckinProgress] = useState(progress);
  const [checkinNote, setCheckinNote] = useState("");

  const sc  = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const cc  = CASCADE_CONFIG[cascadeLevel];
  const pct = Math.min(Math.max(progress, 0), 100);

  const trackColor = sc.color;

  function handleCheckin() {
    onCheckin?.(id, checkinProgress, checkinNote);
    setShowCheckin(false);
    setCheckinNote("");
  }

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        background: "#fff",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Cascade breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
            {cascadeLevel !== "org" && (
              <>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Org</span>
                <span style={{ fontSize: 11, color: "#cbd5e1" }}>→</span>
              </>
            )}
            {cascadeLevel === "individual" && (
              <>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Dept</span>
                <span style={{ fontSize: 11, color: "#cbd5e1" }}>→</span>
              </>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, background: cc.bg, borderRadius: 4, padding: "1px 5px" }}>
              {cc.label}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 500, background: "#f1f5f9", color: "#475569",
              borderRadius: 4, padding: "1px 5px", marginLeft: 2,
            }}>{category}</span>
          </div>

          <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#1e293b", lineHeight: 1.3 }}>
            {title}
          </p>
          {description && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>{description}</p>
          )}
          {parentGoalTitle && (
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "#94a3b8" }}>
              Cascaded from: <em>{parentGoalTitle}</em>
            </p>
          )}
        </div>
        {/* Status badge */}
        <span style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color,
          borderRadius: 20, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {sc.label}
        </span>
      </div>

      {/* Target metric */}
      {targetMetric && (
        <div style={{ fontSize: 12, color: "#475569" }}>
          <span style={{ fontWeight: 600, color: "#1e293b" }}>Target:</span> {targetMetric}
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>Progress</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: trackColor }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: trackColor,
              borderRadius: 99,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>

      {/* Footer: due date + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div>{dueDate && <DueDateChip dueDate={dueDate} />}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {onEdit && (
            <button
              onClick={() => onEdit(id)}
              style={{
                fontSize: 12, padding: "4px 10px", border: "1px solid #e2e8f0",
                borderRadius: 6, background: "#fff", color: "#475569", cursor: "pointer",
              }}
            >
              Edit
            </button>
          )}
          <button
            onClick={() => setShowCheckin(!showCheckin)}
            style={{
              fontSize: 12, padding: "4px 10px", border: "none",
              borderRadius: 6, background: "#1d4ed8", color: "#fff", cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Check-in
          </button>
        </div>
      </div>

      {/* Inline check-in form */}
      {showCheckin && (
        <div
          style={{
            marginTop: 4, padding: 10, background: "#f8fafc", borderRadius: 8,
            border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <label style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>
            New progress (%)
            <input
              type="number" min={0} max={100}
              value={checkinProgress}
              onChange={(e) => setCheckinProgress(Number(e.target.value))}
              style={{
                display: "block", width: "100%", marginTop: 4, padding: "5px 8px",
                border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13,
              }}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>
            Note (optional)
            <textarea
              rows={2}
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
              placeholder="What did you accomplish?"
              style={{
                display: "block", width: "100%", marginTop: 4, padding: "5px 8px",
                border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowCheckin(false)}
              style={{ fontSize: 12, padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCheckin}
              style={{ fontSize: 12, padding: "4px 10px", border: "none", borderRadius: 6, background: "#1d4ed8", color: "#fff", cursor: "pointer", fontWeight: 600 }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
