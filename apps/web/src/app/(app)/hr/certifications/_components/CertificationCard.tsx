"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";
import { daysUntilExpiry, type CertificationStatus } from "@/lib/certifications";

export interface CertificationCardProps {
  id: string;
  certificationName: string;
  issuingBody: string;
  obtainedDate: string;         // ISO date string
  expiryDate?: string | null;  // ISO date string or null (no expiry)
  isMandatory?: boolean;
  // GAP-HR-CERTIFICATIONS-06: status is now always derived once, by the
  // caller, via the shared lib/certifications.ts deriveCardStatus() -- this
  // component no longer re-derives or overrides it locally.
  status: CertificationStatus;
  // GAP-HR-CERTIFICATIONS-03: a plain href, not a callback. page.tsx is a
  // Server Component and a function prop cannot cross that boundary, which
  // previously made the "Renew Now" button permanently unreachable (it was
  // only ever rendered if `onRenew` was passed, and it never was).
  renewHref?: string;
}

export function CertificationCard({
  id,
  certificationName,
  issuingBody,
  obtainedDate,
  expiryDate,
  isMandatory = false,
  status,
  renewHref,
}: CertificationCardProps) {
  const t = useTranslations("certifications");
  const days = expiryDate ? daysUntilExpiry(expiryDate) : null;

  const STATUS_STYLE: Record<CertificationStatus, { label: string; bg: string; color: string; border: string }> = {
    valid:         { label: t("statusValid"),        bg: "var(--goodbg, #f0fdf4)", color: "var(--good, #15803d)", border: "var(--goodbd, #86efac)" },
    expiring_soon: { label: t("statusExpiringSoon"),  bg: "var(--warnbg, #fffbeb)", color: "var(--warn, #d97706)", border: "var(--warnbd, #fcd34d)" },
    expired:       { label: t("statusExpired"),       bg: "var(--badbg, #fef2f2)",  color: "var(--bad, #dc2626)",  border: "var(--badbd, #fca5a5)" },
    no_expiry:     { label: t("noExpiry"),             bg: "var(--line2, #f1f5f9)",  color: "var(--mut, #64748b)",  border: "var(--line, #e2e8f0)" },
  };

  const ss = STATUS_STYLE[status];

  return (
    <div
      id={id}
      style={{
        border: `1px solid ${isMandatory ? "var(--infobd, #bfdbfe)" : "var(--line, #e2e8f0)"}`,
        borderTop: `3px solid ${isMandatory ? "var(--info, #3b82f6)" : "var(--mut, #94a3b8)"}`,
        borderRadius: 10,
        background: "var(--panel, #fff)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        position: "relative",
      }}
    >
      {/* Mandatory badge */}
      {isMandatory && (
        <div
          style={{
            position: "absolute", top: 10, insetInlineEnd: 12,
            fontSize: 10, fontWeight: 700, background: "var(--infobg, #dbeafe)", color: "var(--info, #1d4ed8)",
            borderRadius: 4, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.06em",
          }}
        >
          {t("mandatory")}
        </div>
      )}

      {/* Title & issuing body */}
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--ink, #1e293b)", lineHeight: 1.3, paddingInlineEnd: isMandatory ? 80 : 0 }}>
          {certificationName}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--mut, #64748b)" }}>{issuingBody}</p>
      </div>

      {/* Dates */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, color: "var(--mut)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("obtained")}</p>
          <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: "var(--ink, #1e293b)" }}>{formatIndianDate(obtainedDate)}</p>
        </div>
        {expiryDate ? (
          <div>
            <p style={{ margin: 0, fontSize: 10, color: "var(--mut)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("expires")}</p>
            <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: status === "expired" ? "var(--bad, #dc2626)" : "var(--ink, #1e293b)" }}>
              {formatIndianDate(expiryDate)}
            </p>
          </div>
        ) : (
          <div>
            <p style={{ margin: 0, fontSize: 10, color: "var(--mut)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("expires")}</p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--mut)" }}>{t("noExpiry")}</p>
          </div>
        )}
      </div>

      {/* Expiry warning banner */}
      {status === "expiring_soon" && days !== null && (
        <div
          role="alert"
          style={{
            background: "var(--warnbg, #fffbeb)",
            border: "1px solid var(--warnbd, #fcd34d)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--warn, #d97706)",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>⚠</span>
          {t("bannerSoon", { days })}
        </div>
      )}

      {status === "expired" && (
        <div
          role="alert"
          style={{
            background: "var(--badbg, #fef2f2)",
            border: "1px solid var(--badbd, #fca5a5)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--bad, #dc2626)",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>✖</span>
          {t("bannerExpired")}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: 11, fontWeight: 700, background: ss.bg, color: ss.color,
            border: `1px solid ${ss.border}`, borderRadius: 20, padding: "2px 8px",
          }}
        >
          {ss.label}
        </span>
        {(status === "expiring_soon" || status === "expired") && renewHref && (
          <Link
            href={renewHref}
            style={{
              fontSize: 12, fontWeight: 700, padding: "5px 12px",
              border: "none", borderRadius: 6,
              background: status === "expired" ? "var(--bad, #dc2626)" : "var(--warn, #d97706)",
              color: "#fff", textDecoration: "none", display: "inline-block",
            }}
          >
            {t("renew")}
          </Link>
        )}
      </div>
    </div>
  );
}
