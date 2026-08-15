"use client";

import Link from "next/link";

export type PayrollException = {
  employeeId: string;
  employeeName: string;
  issue: string;
};

type Props = {
  exceptions: PayrollException[];
};

export function ExceptionPanel({ exceptions }: Props) {
  if (exceptions.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label={`${exceptions.length} payroll exception${exceptions.length !== 1 ? "s" : ""} require attention`}
      style={{
        border: "1.5px solid #d97706",
        borderRadius: 10,
        background: "#fffbeb",
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15 }}>⚠️</span>
        <strong style={{ fontSize: 13, color: "#92400e" }}>
          {exceptions.length} employee{exceptions.length !== 1 ? "s" : ""} need attention
          before running payroll
        </strong>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {exceptions.map((ex) => (
          <div
            key={ex.employeeId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              padding: "6px 10px",
              background: "rgba(217,119,6,0.07)",
              borderRadius: 6,
            }}
          >
            <span style={{ fontWeight: 700, color: "#78350f", minWidth: 140, flexShrink: 0 }}>
              {ex.employeeName}
            </span>
            <span style={{ flex: 1, color: "#92400e" }}>{ex.issue}</span>
            <Link
              href={`/hr/employees/${ex.employeeId}`}
              style={{
                fontSize: 11,
                color: "#b45309",
                fontWeight: 700,
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              Fix
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Derive exceptions from salary-slip data (missing info signals). */
export function deriveExceptions(
  slips: Array<{ employeeId: string; employeeName: string; status: string }>,
): PayrollException[] {
  const out: PayrollException[] = [];
  for (const s of slips) {
    if (s.status === "failed") {
      out.push({
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        issue: "Salary calculation failed — check bank account, PAN, or salary structure",
      });
    }
  }
  return out;
}
