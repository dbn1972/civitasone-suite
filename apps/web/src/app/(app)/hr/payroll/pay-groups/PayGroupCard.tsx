"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface PayGroupCardProps {
  id: string;
  name: string;
  frequency: string;
  payDayOfMonth: number;
  timezone: string;
  status: string;
  /** Not returned by GET /v1/payroll/pay-groups today; "—" when absent, never a fabricated 0. */
  employeeCount?: number;
  associatedStructureName?: string;
  lastRevisionDate?: string;
}

const FREQUENCY_ICON: Record<string, string> = {
  monthly: "📅",
  bi_weekly: "📆",
  weekly: "🗓️",
};

// UX-017: keys are the stable backend frequency codes, never translated --
// only used to look up which message key holds the display label.
const FREQUENCY_LABEL_KEYS: Record<string, string> = {
  monthly: "frequencyMonthly",
  bi_weekly: "frequencyBiWeekly",
  weekly: "frequencyWeekly",
};

// GAP-PAYROLL-PAY-GROUPS-05: was coloured amber/green from the *browser*
// clock (a hydration-mismatch risk in a client component) and formatted with
// the browser's timezone. Now a neutral badge with the shared IST formatter.
function RevisionBadge({ date }: { date?: string }) {
  const t = useTranslations("payGroupCard");
  if (!date) return null;
  const formatted = formatIndianDate(date);
  return (
    <span className="pill mut" title={t("lastRevisedTitle", { date: formatted })}>
      {t("revisionBadgeText", { date: formatted })}
    </span>
  );
}

export function PayGroupCard({
  name,
  frequency,
  payDayOfMonth,
  timezone,
  status,
  employeeCount,
  associatedStructureName,
  lastRevisionDate,
}: PayGroupCardProps) {
  const t = useTranslations("payGroupCard");
  const isActive = status === "active";
  const freqIcon = FREQUENCY_ICON[frequency] ?? "📅";
  const freqLabelKey = FREQUENCY_LABEL_KEYS[frequency];
  const freqLabel = freqLabelKey ? t(freqLabelKey) : frequency;

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
              background: isActive ? "var(--good, #10b981)" : "var(--mut, #94a3b8)",
              flexShrink: 0,
            }}
          />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{name}</h3>
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
          <p style={{ margin: 0, fontSize: 11, color: "var(--mut)", fontWeight: 500 }}>{t("employeesLabel")}</p>
          <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>
            {typeof employeeCount === "number" ? employeeCount.toLocaleString("en-IN") : "—"}
          </p>
        </div>
        <div
          style={{
            background: "var(--goodbg, #f0fdf4)",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "var(--mut)", fontWeight: 500 }}>{t("frequencyLabel")}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
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
          <p style={{ margin: 0, fontSize: 11, color: "var(--mut)", fontWeight: 500 }}>{t("payDayLabel")}</p>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
            {/* GAP-PAYROLL-PAY-GROUPS-02: locale ordinal (1st/2nd/3rd/11th/22nd),
                not a hard-coded English "th". */}
            {t("payDayValue", { day: payDayOfMonth })}
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
              color: "var(--mut)",
            }}
          >
            <Link href="/hr/payroll/structures" style={{ color: "inherit" }}>
              {t.rich("structureLabel", { name: associatedStructureName, strong: (chunks) => <strong style={{ color: "var(--ink)" }}>{chunks}</strong> })}
            </Link>
          </span>
        )}
        <span
          style={{
            background: "var(--line2)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--mut)",
          }}
        >
          {timezone}
        </span>
        <span style={{ marginInlineStart: "auto" }}>
          <StatusPill status={status} label={isActive ? t("statusActive") : status === "inactive" ? t("statusInactive") : undefined} />
        </span>
      </div>
    </div>
  );
}
