"use client";

import React, { useState } from "react";

const GRATUITY_CEILING_PAISE = 2_000_000_00; // ₹20,00,000 per GoI (Payment of Gratuity Act)
const GRATUITY_DAYS = 15;
const WORKING_DAYS_PER_MONTH = 26;

export function GratuityCalculator() {
  const [years, setYears] = useState("");
  const [monthlySalary, setMonthlySalary] = useState(""); // in rupees (as string)

  const numYears = parseFloat(years) || 0;
  const numSalary = parseFloat(monthlySalary.replace(/,/g, "")) || 0;

  // Gratuity = (Last Drawn Monthly Salary × 15 / 26) × Completed Years
  const gratuityRaw = (numSalary * GRATUITY_DAYS * Math.floor(numYears)) / WORKING_DAYS_PER_MONTH;
  const maxRupees = GRATUITY_CEILING_PAISE / 100;
  const gratuity = Math.min(gratuityRaw, maxRupees);
  const isCapped = gratuityRaw > maxRupees;
  const hasResult = numYears >= 5 && numSalary > 0;
  const belowEligibility = numYears > 0 && numYears < 5;

  function formatRs(amount: number): string {
    return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "20px 24px",
        maxWidth: 520,
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
        Gratuity Calculator
      </h3>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--fg2)" }}>
        Payment of Gratuity Act, 1972 — applicable after 5 years of continuous service.
        Formula: (Basic + DA) × 15/26 × Completed Years. Maximum: ₹20,00,000.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg2)" }}>
            Last Drawn Monthly Salary (Basic + DA) — ₹
          </span>
          <input
            type="number"
            min="0"
            step="100"
            placeholder="e.g. 55000"
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
            style={{
              height: 38,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--fg)",
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg2)" }}>
            Years of Service
          </span>
          <input
            type="number"
            min="0"
            max="50"
            step="0.5"
            placeholder="e.g. 15"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            style={{
              height: 38,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--fg)",
              fontSize: 14,
            }}
          />
        </label>
      </div>

      {/* Formula trace */}
      {numSalary > 0 && numYears > 0 && (
        <div
          style={{
            marginTop: 16,
            background: "var(--line2)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "var(--fg2)",
            fontFamily: "monospace",
            lineHeight: 1.7,
          }}
        >
          = ({formatRs(numSalary)} × {GRATUITY_DAYS}) / {WORKING_DAYS_PER_MONTH} × {Math.floor(numYears)} years
          <br />
          = {formatRs((numSalary * GRATUITY_DAYS) / WORKING_DAYS_PER_MONTH)} × {Math.floor(numYears)}
          <br />= {formatRs(gratuityRaw)}
          {isCapped && ` → capped at ${formatRs(maxRupees)}`}
        </div>
      )}

      {/* Result */}
      {belowEligibility && (
        <div
          style={{
            marginTop: 14,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "#92400e",
          }}
        >
          Gratuity requires a minimum of <strong>5 years</strong> of continuous service. Current:{" "}
          <strong>{numYears} year{numYears !== 1 ? "s" : ""}</strong>.
        </div>
      )}

      {hasResult && (
        <div
          style={{
            marginTop: 14,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: "14px 18px",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "#14532d" }}>Estimated Gratuity</p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 28,
              fontWeight: 800,
              color: "#16a34a",
              lineHeight: 1,
            }}
          >
            {formatRs(gratuity)}
          </p>
          {isCapped && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>
              Capped at statutory maximum of {formatRs(maxRupees)} as per the Payment of Gratuity Act, 1972.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
