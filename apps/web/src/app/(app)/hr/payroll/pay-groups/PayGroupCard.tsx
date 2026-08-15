"use client";

import React from "react";

interface PayGroupCardProps {
  id: string;
  name: string;
  frequency: string;
  payDayOfMonth: number;
  timezone: string;
  status: string;
  employeeCount?: number;
  associatedStructureName?: string;
  lastRevisionDate?: string;
}

const FREQUENCY_ICON: Record<string, string> = {
  monthly: "📅",
  bi_weekly: "📆",
  weekly: "🗓️",
};

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  bi_weekly: "Bi-weekly",
  weekly: "Weekly",
};

function RevisionBadge({ date }: { date?: string }) {
  if (!date) return null;
  const parsed = new Date(date);
  const now = new Date();
  const diffMonths =
    (now.getFullYear() - parsed.getFullYear()) * 12 + now.getMonth() - parsed.getMonth();
  const isRecent = diffMonths <= 3;

  return (
    <span
      title={`Last revised: ${parsed.toLocaleDateString("en-IN")}`}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        background: isRecent ? "#f0fdf4" : "#fffbeb",
        color: isRecent ? "#16a34a" : "#d97706",
        border: `1px solid ${isRecent ? "#bbf7d0" : "#fde68a"}`,
      }}
    >
      Rev. {parsed.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
    </span>
  );
}

export function PayGroupCard({
  name,
  frequency,
  payDayOfMonth,
  timezone,
  status,
  employeeCount = 0,
  associatedStructureName,
  lastRevisionDate,
}: PayGroupCardProps) {
  const isActive = status === "active";
  const freqIcon = FREQUENCY_ICON[frequency] ?? "📅";
  const freqLabel = FREQUENCY_LABEL[frequency] ?? frequency;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: isActive ? "#10b981" : "#94a3b8",
              flexShrink: 0,
            }}
          />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>{name}</h3>
        </div>
        <RevisionBadge date={lastRevisionDate} />
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        <div
          style={{
            background: "var(--infobg, #eff6ff)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "var(--fg2)", fontWeight: 500 }}>Employees</p>
          <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>
            {employeeCount.toLocaleString("en-IN")}
          </p>
        </div>
        <div
          style={{
            background: "var(--goodbg, #f0fdf4)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "var(--fg2)", fontWeight: 500 }}>Frequency</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>
            {freqIcon} {freqLabel}
          </p>
        </div>
        <div
          style={{
            background: "var(--warnbg, #fffbeb)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "var(--fg2)", fontWeight: 500 }}>Pay Day</p>
          <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>
            {payDayOfMonth}
            <sup style={{ fontSize: 11 }}>th</sup>
          </p>
        </div>
      </div>

      {/* Structure + timezone */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {associatedStructureName && (
          <span
            style={{
              background: "var(--line2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              color: "var(--fg2)",
            }}
          >
            Structure: <strong style={{ color: "var(--fg)" }}>{associatedStructureName}</strong>
          </span>
        )}
        <span
          style={{
            background: "var(--line2)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--fg2)",
          }}
        >
          {timezone}
        </span>
        <span
          className={`pill ${isActive ? "good" : "mut"}`}
          style={{ marginLeft: "auto" }}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
