"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export interface StatutoryComplianceCardProps {
  label: string;
  icon: string;
  empPct: number;
  erPct: number;
  /**
   * Minor units (paise) for a flat monthly wage ceiling (PF/ESI); the literal
   * string "state" for a scheme whose ceiling genuinely varies by state
   * (PT/LWF — see GAP-PAYROLL-STATUTORY-03); "none" for a scheme that has no
   * wage ceiling at all (NPS/GPF). Leaving this `undefined` used to render
   * the same "No ceiling" text as a genuine "none" scheme, which is wrong
   * for PT/LWF (state-specific, not absent).
   */
  wageCeilingMonthly?: number | "state" | "none";
  challanDueDay: number; // day of month (usually 15)
  href: string;
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
  const t = useTranslations("statutoryComplianceCard");

  function formatCeiling(value?: number | "state" | "none"): string {
    if (value === "state") return t("ceilingStateSpecific");
    if (value == null || value === "none") return t("noCeiling");
    return `₹${(value / 100).toLocaleString("en-IN")} /mo`;
  }

  return (
    <Link
      href={href}
      className="statutory-card"
      style={{
        display: "block",
        background: "var(--panel)",
        border: "1.5px solid var(--line)",
        borderRadius: 12,
        padding: "18px 20px",
        textDecoration: "none",
        color: "inherit",
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
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{label}</span>
        </div>
        {/* NOTE: this card used to show a "Filed"/"Pending" compliance-status
            badge here, hardcoded per statutory type with no real filing data
            behind it (see the old STATUTORY_CARDS complianceStatus literals
            in page.tsx) -- a compliance dashboard confidently displaying a
            fabricated status is worse than showing none, so it has been
            removed. Real filing status lives in Challans & Reconciliation.
            GAP-PAYROLL-STATUTORY-04: the "See Challans & Reconciliation for
            filing status" pointer used to repeat here as non-link text on
            all six cards; it is now one real link on the hub page itself
            (see statutory/page.tsx), not duplicated per-card. */}
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
          <p style={{ margin: 0, fontSize: 10, color: "var(--mut)", fontWeight: 500, textTransform: "uppercase" }}>
            {t("employee")}
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 22,
              fontWeight: 800,
              color: "var(--ink)",
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
          <p style={{ margin: 0, fontSize: 10, color: "var(--mut)", fontWeight: 500, textTransform: "uppercase" }}>
            {t("employer")}
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 22,
              fontWeight: 800,
              color: "var(--ink)",
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
          color: "var(--mut)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("wageCeiling")}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            {formatCeiling(wageCeilingMonthly)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("challanDue")}</span>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>
            {t("challanDueLabel", { day: challanDueDay })}
          </span>
        </div>
      </div>
    </Link>
  );
}
