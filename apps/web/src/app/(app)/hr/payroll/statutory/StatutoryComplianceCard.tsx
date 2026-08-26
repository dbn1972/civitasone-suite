"use client";

import React from "react";

export interface StatutoryComplianceCardProps {
  label: string;
  icon: string;
  empPct: number;
  erPct: number;
  wageCeilingMonthly?: number; // in paise (minor units)
  challanDueDay: number; // day of month (usually 15)
  href: string;
}

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
  href,
}: StatutoryComplianceCardProps) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        background: "var(--panel)",
        border: "1.5px solid var(--line)",
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
        {/* NOTE: this card used to show a "Filed"/"Pending" compliance-status
            badge here, hardcoded per statutory type with no real filing data
            behind it (see the old STATUTORY_CARDS complianceStatus literals
            in page.tsx) -- a compliance dashboard confidently displaying a
            fabricated status is worse than showing none, so it has been
            removed. Real filing status lives in Challans & Reconciliation. */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--accent, #2563eb)",
          }}
        >
          See Challans & Reconciliation for filing status
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
      </div>
    </a>
  );
}
