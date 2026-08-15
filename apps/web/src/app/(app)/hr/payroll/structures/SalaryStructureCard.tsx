"use client";

import React from "react";
import { Chart } from "@/app/_components/Chart";

interface ComponentItem {
  id: string;
  code: string;
  name: string;
  componentType: string;
  isTaxable: boolean;
}

export interface SalaryStructureCardProps {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
  components: ComponentItem[];
}

// GoI 7th CPC standard component percentage distribution of gross salary
const GOI_STANDARD_PCT: { label: string; value: number; color: string }[] = [
  { label: "Basic", value: 50, color: "#4f46e5" },
  { label: "DA (46%)", value: 23, color: "#06b6d4" },
  { label: "HRA", value: 10, color: "#10b981" },
  { label: "TA+Transport", value: 8, color: "#f59e0b" },
  { label: "Other Allow.", value: 5, color: "#8b5cf6" },
  { label: "Deductions", value: 4, color: "#ef4444" },
];

// Infer GoI pay bands from structure name
function inferPayBands(name: string): string[] {
  const lower = name.toLowerCase();
  if (lower.includes("mts") || lower.includes("multi-task") || lower.includes("group d") || lower.includes("level 1") || lower.includes("level 2")) {
    return ["MTS", "Helper"];
  }
  if (lower.includes("ldc") || lower.includes("level 3")) {
    return ["LDC"];
  }
  if (lower.includes("udc") || lower.includes("level 4")) {
    return ["UDC", "LDC"];
  }
  if (lower.includes("assistant") && !lower.includes("section") && (lower.includes("level 5") || lower.includes("level 6"))) {
    return ["Assistant", "UDC"];
  }
  if (lower.includes("section officer") || lower.includes("level 7") || lower.includes("level 8")) {
    return ["Section Officer", "Assistant SO"];
  }
  if (lower.includes("director") || lower.includes("level 9") || lower.includes("level 10") || lower.includes("level 11")) {
    return ["Dy. Director", "Director"];
  }
  if (lower.includes("group a") || lower.includes("gazetted") || lower.includes("ias") || lower.includes("ips")) {
    return ["Section Officer", "Dy. Director", "Director", "Jt. Secretary"];
  }
  if (lower.includes("group b")) {
    return ["Assistant", "Section Officer"];
  }
  if (lower.includes("group c")) {
    return ["MTS", "LDC", "UDC"];
  }
  if (lower.includes("contractual") || lower.includes("contract") || lower.includes("adhoc")) {
    return ["Contractual"];
  }
  // Default: all bands
  return ["MTS", "LDC", "UDC", "Assistant", "Section Officer"];
}

function buildChartData(components: ComponentItem[]) {
  if (components.length === 0) return GOI_STANDARD_PCT;

  const earnings = components.filter(
    (c) => c.componentType === "earning" || c.componentType === "allowance" || !c.componentType
  );
  const deductions = components.filter((c) => c.componentType === "deduction");
  const employer = components.filter((c) => c.componentType === "employer_contribution");
  const other = components.filter(
    (c) => !["earning", "allowance", "deduction", "employer_contribution"].includes(c.componentType ?? "")
  );
  const total = components.length;

  return [
    { label: `Earnings (${earnings.length})`, value: earnings.length, color: "#4f46e5" },
    { label: `Deductions (${deductions.length})`, value: deductions.length, color: "#ef4444" },
    { label: `Employer (${employer.length})`, value: employer.length, color: "#10b981" },
    { label: `Other (${other.length})`, value: other.length, color: "#f59e0b" },
  ].filter((d) => d.value > 0);
}

export function SalaryStructureCard({ name, isDefault, status, components }: SalaryStructureCardProps) {
  const payBands = inferPayBands(name);
  const chartData = buildChartData(components);
  const isActive = status === "active";

  return (
    <div
      style={{
        background: "var(--panel)",
        border: `1.5px solid ${isDefault ? "var(--accent, #4f46e5)" : "var(--line)"}`,
        borderRadius: 14,
        padding: "20px 24px",
        position: "relative",
      }}
    >
      {isDefault && (
        <span
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "var(--accent, #4f46e5)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 10px",
            borderRadius: 20,
          }}
        >
          Default
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: isActive ? "#10b981" : "#94a3b8",
            flexShrink: 0,
          }}
        />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--fg)" }}>{name}</h3>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--fg2)" }}>
        {components.length > 0
          ? `${components.length} component${components.length !== 1 ? "s" : ""}`
          : "GoI standard distribution shown"}{" "}
        &bull; <span style={{ textTransform: "capitalize" }}>{status}</span>
      </p>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto" }}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fg2)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            % of Gross
          </p>
          <Chart type="donut" data={chartData} height={130} />
        </div>

        <div style={{ flex: 1, minWidth: 160, paddingTop: 20 }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fg2)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Applicable Pay Levels
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {payBands.map((band) => (
              <span
                key={band}
                style={{
                  background: "var(--infobg, #eff6ff)",
                  color: "var(--infofg, #1d4ed8)",
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "3px 10px",
                  borderRadius: 20,
                  border: "1px solid var(--infoline, #bfdbfe)",
                }}
              >
                {band}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
