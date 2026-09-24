"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export type PayrollException = {
  employeeId: string;
  employeeName: string;
  issue: string;
};

type Props = {
  exceptions: PayrollException[];
};

export function ExceptionPanel({ exceptions }: Props) {
  const t = useTranslations("exceptionPanel");
  if (exceptions.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label={t("panelAriaLabel", { count: exceptions.length })}
      style={{
        border: "1.5px solid var(--warn, #d97706)",
        borderRadius: 10,
        background: "var(--warnbg, #fffbeb)",
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
        <strong style={{ fontSize: 13, color: "var(--warn, #92400e)" }}>
          {t("headingText", { count: exceptions.length })}
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
              background: "var(--warnbg, rgba(217,119,6,0.07))",
              borderRadius: 6,
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--warn, #78350f)", minWidth: 140, flexShrink: 0 }}>
              {ex.employeeName}
            </span>
            <span style={{ flex: 1, color: "var(--warn, #92400e)" }}>{ex.issue}</span>
            <Link
              href={`/hr/employees/${ex.employeeId}`}
              style={{
                fontSize: 11,
                color: "var(--warn, #b45309)",
                fontWeight: 700,
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              {t("fixLink")}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Derive exceptions from salary-slip data (missing info signals).
 * `t` is the caller's own translator (payrollDetail, a Server Component
 * translator obtained via getTranslations) -- this is a plain data-shaping
 * function, not a component, so it cannot call useTranslations() itself.
 */
export function deriveExceptions(
  slips: Array<{ employeeId: string; employeeName: string; status: string }>,
  t: (key: string) => string,
): PayrollException[] {
  const out: PayrollException[] = [];
  for (const s of slips) {
    if (s.status === "failed") {
      out.push({
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        issue: t("exceptionSalaryCalcFailed"),
      });
    }
  }
  return out;
}
