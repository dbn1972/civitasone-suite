"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import type { PayrollException } from "./deriveExceptions";

// The pure data-shaping half (deriveExceptions / EXCEPTION_ISSUE_KEYS) lives in
// ./deriveExceptions.ts, a plain module: this file is "use client", so anything
// exported from it is a client reference on the server. The Server Component
// page calling deriveExceptions() from here crashed every payroll run detail
// render ("Attempted to call deriveExceptions() from the server").
export type { PayrollException };

type Props = {
  exceptions: PayrollException[];
};

export function ExceptionPanel({ exceptions }: Props) {
  const t = useTranslations("exceptionPanel");
  const tFallback = useTranslations("employeeFallback");
  if (exceptions.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label={t("panelAriaLabel", { count: exceptions.length })}
      style={{
        border: "1.5px solid var(--warn)",
        borderRadius: 10,
        background: "var(--warnbg)",
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
        <strong style={{ fontSize: 13, color: "var(--warn)" }}>
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
            <span style={{ fontWeight: 700, color: "var(--warn)", minWidth: 140, flexShrink: 0 }}>
              {ex.employeeName?.trim() || tFallback("unknownEmployee")}
            </span>
            <span style={{ flex: 1, color: "var(--warn)" }}>{ex.issue}</span>
            <Link
              href={`/hr/employees/${ex.employeeId}`}
              style={{
                fontSize: 11,
                color: "var(--warn)",
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
