"use client";

import type { CSSProperties } from "react";
import { StatusPill } from "@/app/_components/ds";

/**
 * TravelClaimCard — displays a single TA/DA claim with route details,
 * fare class and hotel stay entitlement.
 * GFR 2017 Chapter 19 / CCS (TA) Rules 1988 Second Schedule —
 * entitlement based on pay level (7th CPC).
 *
 * Correct fare class mapping per CCS(TA) Rules 1988 Second Schedule:
 *   Level 1–5  : Sleeper Class (AC-III approved cases; bus/road ≤ 100 km)
 *   Level 6–8  : AC-II Tier
 *   Level 9–17 : AC-I Tier (First Class)
 *   Level 18   : Business Class (domestic flights) / AC-I
 */

export type FareClass = "AC-I" | "AC-II" | "AC-III" | "Sleeper" | "Economy" | "Business";
export type AuditStatus = "Pending" | "Under Audit" | "Approved" | "Rejected" | "Paid";

export interface TravelClaimCardProps {
  id: string;
  employeeName: string;
  employeeNo: string;
  payLevel: number;
  from: string;
  to: string;
  departureDate: string;
  returnDate: string;
  purpose: string;
  fareClass: FareClass;
  fareAmount: number;
  daAmount: number;
  hotelAmount: number;
  hotelNights?: number;
  totalAmount: number;
  auditStatus: AuditStatus;
  auditRemark?: string;
}

/** CCS(TA) Rules 1988 Second Schedule — 7th CPC pay levels */
const FARE_CLASS_ENTITLEMENT: Record<number, FareClass> = {
  1: "Sleeper",
  2: "Sleeper",
  3: "Sleeper",
  4: "Sleeper",
  5: "Sleeper",
  6: "AC-II",
  7: "AC-II",
  8: "AC-II",
  9: "AC-I",
  10: "AC-I",
  11: "AC-I",
  12: "AC-I",
  13: "AC-I",
  14: "AC-I",
  15: "AC-I",
  16: "AC-I",
  17: "AC-I",
  18: "Business",
};

function fareClassLabel(payLevel: number, actualClass: FareClass): React.ReactNode {
  const entitled = FARE_CLASS_ENTITLEMENT[payLevel] ?? "Sleeper";
  const classOrder: FareClass[] = ["Business", "Economy", "AC-I", "AC-II", "AC-III", "Sleeper"];
  const entitledIdx = classOrder.indexOf(entitled);
  const actualIdx = classOrder.indexOf(actualClass);
  const exceeded = actualIdx < entitledIdx; // lower index = higher class

  // Level 1–4: bus/road travel applicable for short distances (≤ 100 km)
  const busRoadNote = payLevel >= 1 && payLevel <= 4;

  return (
    <span
      title={`Entitlement for Pay Level ${payLevel}: ${entitled}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: exceeded ? "#b91c1c" : "inherit",
        fontWeight: exceeded ? 600 : 400,
      }}
    >
      {actualClass}
      {busRoadNote && (
        <span style={{ fontSize: 11, color: "var(--mut)" }}>(bus/road ≤ 100 km)</span>
      )}
      {exceeded && (
        <span
          aria-label="Fare class exceeds entitlement"
          title={`Exceeds entitlement (${entitled}) for Pay Level ${payLevel}`}
          style={{ color: "#ef4444" }}
        >
          ⚠
        </span>
      )}
    </span>
  );
}

function formatINR(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--bg)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "1px solid var(--line)",
  gap: 12,
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: "10px 20px",
  padding: "14px 18px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--mut)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 2,
};

const fieldValueStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={fieldValueStyle}>{children}</div>
    </div>
  );
}

export function TravelClaimCard({
  id,
  employeeName,
  employeeNo,
  payLevel,
  from,
  to,
  departureDate,
  returnDate,
  purpose,
  fareClass,
  fareAmount,
  daAmount,
  hotelAmount,
  hotelNights,
  totalAmount,
  auditStatus,
  auditRemark,
}: TravelClaimCardProps) {
  return (
    <article style={cardStyle} aria-label={`Travel claim ${id}`}>
      <div style={headerStyle}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
            {employeeName}
            <span style={{ fontWeight: 400, color: "var(--mut)", marginLeft: 8, fontSize: 13 }}>
              {employeeNo}
            </span>
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--mut)" }}>
            Pay Level {payLevel} · {purpose}
          </p>
        </div>
        <StatusPill status={auditStatus} />
      </div>

      <div style={bodyStyle}>
        <Field label="Route">
          {from} → {to}
        </Field>
        <Field label="Departure">{departureDate}</Field>
        <Field label="Return">{returnDate}</Field>
        <Field label="Fare Class (7th CPC)">
          {fareClassLabel(payLevel, fareClass)}
        </Field>
        <Field label="Fare">{formatINR(fareAmount)}</Field>
        <Field label="DA">{formatINR(daAmount)}</Field>
        <Field label="Hotel Stay">
          {hotelNights != null ? `${hotelNights} night(s) — ${formatINR(hotelAmount)}` : "—"}
        </Field>
        <Field label="Total Claim">
          <span style={{ fontWeight: 700, color: "var(--accent, #1a56db)" }}>
            {formatINR(totalAmount)}
          </span>
        </Field>
      </div>

      {auditRemark && (
        <p
          role="note"
          style={{
            margin: 0,
            padding: "8px 18px 12px",
            fontSize: 12,
            color: auditStatus === "Rejected" ? "#b91c1c" : "var(--mut)",
            borderTop: "1px solid var(--line)",
          }}
        >
          Audit remark: {auditRemark}
        </p>
      )}
    </article>
  );
}
