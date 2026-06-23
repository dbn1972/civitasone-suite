"use client";

import React from "react";

export interface GanttTask {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progress: number;
  color?: string;
}

interface GanttChartProps {
  tasks: GanttTask[];
  startDate?: string;
  endDate?: string;
}

const DEFAULT_COLORS = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function parseDate(d: string): number {
  return new Date(d).getTime();
}

function formatMonth(d: Date): string {
  return d.toLocaleString("en", { month: "short", year: "2-digit" });
}

export function GanttChart({ tasks, startDate, endDate }: GanttChartProps) {
  if (tasks.length === 0) {
    return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No tasks to display</div>;
  }

  const allStarts = tasks.map((t) => parseDate(t.startDate));
  const allEnds = tasks.map((t) => parseDate(t.endDate));
  const chartStart = startDate ? parseDate(startDate) : Math.min(...allStarts);
  const chartEnd = endDate ? parseDate(endDate) : Math.max(...allEnds);
  const totalDuration = chartEnd - chartStart || 1;

  // Generate month markers
  const months: { label: string; offset: number }[] = [];
  const d = new Date(chartStart);
  d.setDate(1);
  while (d.getTime() <= chartEnd) {
    const offset = ((d.getTime() - chartStart) / totalDuration) * 100;
    if (offset >= 0 && offset <= 100) {
      months.push({ label: formatMonth(d), offset });
    }
    d.setMonth(d.getMonth() + 1);
  }

  const ROW_HEIGHT = 36;
  const HEADER_HEIGHT = 28;
  const LEFT_WIDTH = 160;
  const chartHeight = tasks.length * ROW_HEIGHT + HEADER_HEIGHT + 8;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div style={{ minWidth: 600, position: "relative" }}>
        {/* Header with months */}
        <div style={{ display: "flex", height: HEADER_HEIGHT }}>
          <div style={{ width: LEFT_WIDTH, flexShrink: 0 }} />
          <div style={{ flex: 1, position: "relative", borderBottom: "1px solid #e5e7eb" }}>
            {months.map((m, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${m.offset}%`,
                  fontSize: 10,
                  color: "#64748b",
                  fontWeight: 500,
                  top: 6,
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>

        {/* Task rows */}
        {tasks.map((task, i) => {
          const taskStart = parseDate(task.startDate);
          const taskEnd = parseDate(task.endDate);
          const left = ((taskStart - chartStart) / totalDuration) * 100;
          const width = ((taskEnd - taskStart) / totalDuration) * 100;
          const color = task.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];

          return (
            <div
              key={task.id}
              style={{
                display: "flex",
                height: ROW_HEIGHT,
                alignItems: "center",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              {/* Task name */}
              <div
                style={{
                  width: LEFT_WIDTH,
                  flexShrink: 0,
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#334155",
                  padding: "0 8px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={task.name}
              >
                {task.name}
              </div>
              {/* Bar area */}
              <div style={{ flex: 1, position: "relative", height: 20 }}>
                {/* Background bar */}
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, left)}%`,
                    width: `${Math.min(width, 100 - left)}%`,
                    height: 18,
                    top: 1,
                    borderRadius: 4,
                    background: `${color}33`,
                  }}
                />
                {/* Progress fill */}
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, left)}%`,
                    width: `${Math.min(width, 100 - left) * (task.progress / 100)}%`,
                    height: 18,
                    top: 1,
                    borderRadius: 4,
                    background: color,
                    transition: "width 0.3s",
                  }}
                  title={`${task.progress}% complete`}
                />
                {/* Label on bar */}
                <span
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, left) + 1}%`,
                    top: 3,
                    fontSize: 9,
                    fontWeight: 600,
                    color: "#fff",
                    pointerEvents: "none",
                  }}
                >
                  {task.progress > 10 ? `${task.progress}%` : ""}
                </span>
              </div>
            </div>
          );
        })}

        {/* Month grid lines */}
        <div
          style={{
            position: "absolute",
            top: HEADER_HEIGHT,
            bottom: 0,
            left: LEFT_WIDTH,
            right: 0,
            pointerEvents: "none",
          }}
        >
          {months.map((m, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${m.offset}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: "#f1f5f9",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
