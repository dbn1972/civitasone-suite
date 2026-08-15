"use client";

import { formatRupees } from "@/lib/formatters";

type Props = {
  currentGross: number;
  previousGross: number;
  currentNet: number;
  currentPeriod: string;
  previousPeriod: string;
};

export function MonthOverMonthCards({
  currentGross,
  previousGross,
  currentNet,
  currentPeriod,
  previousPeriod,
}: Props) {
  const diff  = currentGross - previousGross;
  const pct   = previousGross > 0 ? (diff / previousGross) * 100 : 0;
  const isUp  = diff >= 0;
  const ratio = currentGross > 0
    ? ((currentNet / currentGross) * 100).toFixed(1)
    : "—";

  const cardStyle: React.CSSProperties = {
    flex: "1 1 180px",
    minWidth: 160,
    background: "var(--panel,#f8fafc)",
    border: "1px solid var(--line,#e2e8f0)",
    borderRadius: 10,
    padding: "14px 16px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "var(--mut,#64748b)",
    marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--fg,#0f172a)",
    lineHeight: 1.2,
  };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      {/* Current month gross */}
      <div style={cardStyle}>
        <div style={labelStyle}>{currentPeriod} — Gross</div>
        <div style={valueStyle}>{formatRupees(currentGross)}</div>
      </div>

      {/* Previous month gross + MoM delta */}
      <div style={cardStyle}>
        <div style={labelStyle}>{previousPeriod} — Gross</div>
        <div style={valueStyle}>{formatRupees(previousGross)}</div>
        {previousGross > 0 && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 600,
              color: isUp ? "var(--success,#16a34a)" : "var(--danger,#dc2626)",
            }}
          >
            {isUp ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}% vs {previousPeriod}
          </div>
        )}
      </div>

      {/* Net-to-Gross ratio */}
      <div style={cardStyle}>
        <div style={labelStyle}>Net-to-Gross Ratio</div>
        <div style={valueStyle}>{ratio}{ratio !== "—" ? "%" : ""}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--mut,#64748b)" }}>
          Net {formatRupees(currentNet)} of Gross {formatRupees(currentGross)}
        </div>
      </div>
    </div>
  );
}
