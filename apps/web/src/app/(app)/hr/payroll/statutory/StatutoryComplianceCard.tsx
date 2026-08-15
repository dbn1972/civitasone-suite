"use client";

import React from "react";

export type ComplianceStatus = "filed" | "pending" | "overdue";

export interface StatutoryComplianceCardProps {
  label: string;
  icon: string;
  empPct: number;
  erPct: number;
  wageCeilingMonthly?: number; // in paise (minor units)
  challanDueDay: number; // day of month (usually 15)
  complianceStatus: ComplianceStatus;
  nextDueDate?: string; // ISO date string
  href: string;
}

const STATUS_CONFIG: Record<
  ComplianceStatus,
  { label: string; bg: string; fg: string; border: string; icon: string }
> = {
  filed: {
    label: "Filed",
    bg: "#f0fdf4",
    fg: "#16a34a",
    border: "#bbf7d0",
    icon: "✅",
  },
  pending: {
    label: "Pending",
    bg: "#fffbeb",
    fg: "#d97706",
    border: "#fde68a",
    icon: "⏳",
  },
  overdue: {
    label: "Overdue",
    bg: "#fef2f2",
    fg: "#dc2626",
    border: "#fecaca",
    icon: "🚨",
  },
};

function formatMinor(minor?: number): string {
  if (minor == null) return "No ceiling";
  return `₹${(minor / 100).toLocaleString("en-IN")} /mo`;
}

export function StatutoryComplianceCard({
  label,
  icon,
  empPct,
  erPct,
  wageCeilingMonthly,
  challanDueDay,
  complianceStatus,
  nextDueDate,
  href,
}: StatutoryComplianceCardProps) {
  const status = STATUS_CONFIG[complianceStatus];
  const now = new Date();
  const dueMonth = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <a
      href={href}
      style={{
        display: "block",
        background: "var(--panel)",
        border: `1.5px solid ${complianceStatus === "overdue" ? "#fecaca" : "var(--line)"}`,
        borderRadius: 12,
        padding: "18px 20px",
        textDecoration: "none",
        color: "inherit",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
      }}
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--fg)" }}>{label}</span>
        </div>
        {/* Compliance status badge */}
        <span
          style={{
            background: status.bg,
            color: status.fg,
            border: `1px solid ${status.border}`,
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 10px",
          }}
        >
          {status.icon} {status.label}
        </span>
      </div>

      {/* Rate grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            background: "var(--infobg, #eff6ff)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 10, color: "var(--fg2)", fontWeight: 500, textTransform: "uppercase" }}>
            Employee
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 22,
              fontWeight: 800,
              color: "var(--fg)",
              lineHeight: 1,
            }}
          >
            {empPct}%
          </p>
        </div>
        <div
          style={{
            background: "var(--goodbg, #f0fdf4)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 10, color: "var(--fg2)", fontWeight: 500, textTransform: "uppercase" }}>
            Employer
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 22,
              fontWeight: 800,
              color: "var(--fg)",
              lineHeight: 1,
            }}
          >
            {erPct}%
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 12,
          color: "var(--fg2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Wage ceiling</span>
          <span style={{ fontWeight: 600, color: "var(--fg)" }}>
            {formatMinor(wageCeilingMonthly)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Challan due</span>
          <span style={{ fontWeight: 600, color: "var(--fg)" }}>
            {challanDueDay}th of every month
          </span>
        </div>
        {nextDueDate && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Next due</span>
            <span
              style={{
                fontWeight: 600,
                color: complianceStatus === "overdue" ? "#dc2626" : "var(--fg)",
              }}
            >
              {new Date(nextDueDate).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        )}
      </div>
    </a>
  );
}
