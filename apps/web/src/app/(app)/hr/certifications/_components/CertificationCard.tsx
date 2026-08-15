"use client";

import React from "react";

export interface CertificationCardProps {
  id: string;
  certificationName: string;
  issuingBody: string;
  obtainedDate: string;         // ISO date string
  expiryDate?: string | null;  // ISO date string or null (no expiry)
  isMandatory?: boolean;
  status?: "valid" | "expired" | "expiring_soon";
  onRenew?: (id: string) => void;
}

function daysUntilExpiry(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function CertificationCard({
  id,
  certificationName,
  issuingBody,
  obtainedDate,
  expiryDate,
  isMandatory = false,
  status: statusProp,
  onRenew,
}: CertificationCardProps) {
  const days = expiryDate ? daysUntilExpiry(expiryDate) : null;

  // Derive status if not provided
  let status = statusProp ?? "valid";
  if (days !== null && status === "valid") {
    if (days < 0)  status = "expired";
    else if (days <= 30) status = "expiring_soon";
  }

  const STATUS_STYLE: Record<typeof status, { label: string; bg: string; color: string; border: string }> = {
    valid:         { label: "Valid",           bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
    expiring_soon: { label: "Expiring Soon",   bg: "#fffbeb", color: "#d97706", border: "#fcd34d" },
    expired:       { label: "Expired",         bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  };

  const ss = STATUS_STYLE[status];

  return (
    <div
      style={{
        border: `1px solid ${isMandatory ? "#bfdbfe" : "#e2e8f0"}`,
        borderTop: `3px solid ${isMandatory ? "#3b82f6" : "#94a3b8"}`,
        borderRadius: 10,
        background: "#fff",
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
            position: "absolute", top: 10, right: 12,
            fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8",
            borderRadius: 4, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.06em",
          }}
        >
          Mandatory
        </div>
      )}

      {/* Title & issuing body */}
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1e293b", lineHeight: 1.3, paddingRight: isMandatory ? 80 : 0 }}>
          {certificationName}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>{issuingBody}</p>
      </div>

      {/* Dates */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Obtained</p>
          <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{formatDate(obtainedDate)}</p>
        </div>
        {expiryDate ? (
          <div>
            <p style={{ margin: 0, fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Expires</p>
            <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: status === "expired" ? "#dc2626" : "#1e293b" }}>
              {formatDate(expiryDate)}
            </p>
          </div>
        ) : (
          <div>
            <p style={{ margin: 0, fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Expires</p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "#94a3b8" }}>No expiry</p>
          </div>
        )}
      </div>

      {/* Expiry warning banner */}
      {status === "expiring_soon" && days !== null && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#d97706",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>⚠</span>
          Expires in {days} day{days !== 1 ? "s" : ""} — renewal required
        </div>
      )}

      {status === "expired" && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#dc2626",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>✖</span>
          Certification expired — please renew immediately
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
        {(status === "expiring_soon" || status === "expired") && onRenew && (
          <button
            onClick={() => onRenew(id)}
            style={{
              fontSize: 12, fontWeight: 700, padding: "5px 12px",
              border: "none", borderRadius: 6,
              background: status === "expired" ? "#dc2626" : "#d97706",
              color: "#fff", cursor: "pointer",
            }}
          >
            Renew Now
          </button>
        )}
      </div>
    </div>
  );
}
