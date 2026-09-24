"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

interface ComponentRow {
  id: string;
  code: string;
  name: string;
  componentType: string;
  isTaxable: boolean;
  structureId?: string | null;
}

interface ComponentGridProps {
  components: ComponentRow[];
}

type Taxability = "Taxable" | "Exempt" | "Partially Exempt";

// GoI / Income Tax Act taxability classification by component code
function getTaxability(code: string, isTaxable: boolean): Taxability {
  const upper = code.toUpperCase();
  if (upper.includes("HRA")) return "Partially Exempt";
  if (upper.includes("LTA") || upper.includes("LTC")) return "Partially Exempt";
  if (upper.includes("MEDICAL") || upper.includes("MEDICLAIM")) return "Exempt";
  if (upper.includes("TA") || upper.includes("TRANSPORT")) return "Partially Exempt";
  if (upper.includes("NPS") || upper.includes("GPF") || upper.includes("PF") || upper.includes("EPF")) return "Exempt";
  if (upper.includes("GRATUITY")) return "Partially Exempt";
  if (upper.includes("DA") || upper.includes("DEARNESS")) return "Taxable";
  if (upper.includes("BASIC")) return "Taxable";
  return isTaxable ? "Taxable" : "Exempt";
}

// Known GoI salary component formulas. Keys are stable component-code
// prefixes, never translated -- only used to look up which message key
// holds the display formula text (same safe pattern as
// salary-revisions/page.tsx's REVISION_TYPE_KEYS).
const COMPONENT_FORMULA_KEYS: Record<string, string> = {
  BASIC: "formulaBasic",
  DA: "formulaDa",
  HRA: "formulaHra",
  TA: "formulaTa",
  TRANSPORT: "formulaTransport",
  MEDICAL: "formulaMedical",
  LTA: "formulaLta",
  LTC: "formulaLtc",
  NPS: "formulaNps",
  GPF: "formulaGpf",
  PF: "formulaPf",
  EPF: "formulaEpf",
  GRATUITY: "formulaGratuity",
  BONUS: "formulaBonus",
  INCENTIVE: "formulaIncentive",
};

function getFormulaKey(code: string): string | null {
  const upper = code.toUpperCase();
  for (const key of Object.keys(COMPONENT_FORMULA_KEYS)) {
    if (upper.includes(key)) return COMPONENT_FORMULA_KEYS[key];
  }
  return null;
}

const TAXABILITY_STYLE: Record<Taxability, { background: string; color: string; border: string }> = {
  Taxable: { background: "var(--badbg)", color: "var(--bad)", border: "1px solid var(--badbd)" },
  Exempt: { background: "var(--goodbg)", color: "var(--good)", border: "1px solid var(--goodbd)" },
  "Partially Exempt": { background: "var(--warnbg)", color: "var(--warn)", border: "1px solid var(--warnbd)" },
};

// UX-017: keys are the stable Taxability discriminant values, never
// translated directly -- only used to look up the display label and style.
const TAXABILITY_LABEL_KEYS: Record<Taxability, string> = {
  Taxable: "taxabilityTaxable",
  Exempt: "taxabilityExempt",
  "Partially Exempt": "taxabilityPartiallyExempt",
};

const TYPE_BADGE: Record<string, { bg: string; fg: string }> = {
  earning: { bg: "var(--infobg, #eff6ff)", fg: "#1d4ed8" },
  allowance: { bg: "var(--infobg, #eff6ff)", fg: "#1d4ed8" },
  deduction: { bg: "var(--badbg)", fg: "var(--bad)" },
  employer_contribution: { bg: "var(--goodbg)", fg: "var(--good)" },
  reimbursement: { bg: "var(--warnbg)", fg: "var(--warn)" },
};

// UX-017: keys are the stable backend componentType codes, never translated
// -- only used to look up which message key holds the display label.
const TYPE_LABEL_KEYS: Record<string, string> = {
  earning: "typeEarning",
  allowance: "typeAllowance",
  deduction: "typeDeduction",
  employer_contribution: "typeEmployerContribution",
  reimbursement: "typeReimbursement",
};

function TypeBadge({ type }: { type: string }) {
  const t = useTranslations("componentGrid");
  const style = TYPE_BADGE[type] ?? { bg: "var(--line2)", fg: "var(--mut)" };
  const labelKey = TYPE_LABEL_KEYS[type];
  return (
    <span
      style={{
        background: style.bg,
        color: style.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        textTransform: labelKey ? "none" : "capitalize",
      }}
    >
      {labelKey ? t(labelKey) : type || t("typeOther")}
    </span>
  );
}

function TaxabilityBadge({ taxability }: { taxability: Taxability }) {
  const t = useTranslations("componentGrid");
  const s = TAXABILITY_STYLE[taxability];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, ...s }}>
      {t(TAXABILITY_LABEL_KEYS[taxability])}
    </span>
  );
}

function FormulaTooltip({ code }: { code: string }) {
  const t = useTranslations("componentGrid");
  const [visible, setVisible] = useState(false);
  const formulaKey = getFormulaKey(code);
  const formula = formulaKey ? t(formulaKey) : t("formulaNotConfigured");
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label={t("calcFormulaAriaLabel", { code })}
        style={{
          background: "var(--line2)",
          border: "none",
          borderRadius: "50%",
          width: 18,
          height: 18,
          fontSize: 11,
          cursor: "pointer",
          color: "var(--mut)",
          fontWeight: 700,
          lineHeight: "18px",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        f
      </button>
      {visible && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            insetInlineStart: "50%",
            transform: "translateX(-50%)",
            background: "var(--ink, #1e293b)",
            color: "var(--bg, #f1f5f9)",
            fontSize: 12,
            padding: "8px 12px",
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            width: 260,
            zIndex: 100,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            lineHeight: 1.5,
          }}
        >
          {formula}
        </div>
      )}
    </span>
  );
}

export function ComponentGrid({ components }: ComponentGridProps) {
  const t = useTranslations("componentGrid");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of components) init[c.id] = true;
    return init;
  });
  const [filter, setFilter] = useState("");

  const filtered = components.filter(
    (c) =>
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.code.toLowerCase().includes(filter.toLowerCase()) ||
      c.componentType?.toLowerCase().includes(filter.toLowerCase())
  );

  if (components.length === 0) {
    return (
      <div
        style={{
          padding: "40px 24px",
          textAlign: "center",
          color: "var(--mut)",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>🧩</div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{t("emptyTitle")}</p>
        <p style={{ margin: "6px 0 0", fontSize: 13 }}>
          {t("emptyMessage")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="search"
          aria-label={t("filterAriaLabel")}
          placeholder={t("filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: "1 1 220px",
            maxWidth: 320,
            height: 36,
            padding: "0 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--ink)",
            fontSize: 13,
          }}
        />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          {t("countSummary", { filtered: filtered.length, total: components.length })}
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line)" }}>
              <th style={{ textAlign: "start", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colCode")}
              </th>
              <th style={{ textAlign: "start", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colComponentName")}
              </th>
              <th style={{ textAlign: "start", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colType")}
              </th>
              <th style={{ textAlign: "center", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colFormula")}
              </th>
              <th style={{ textAlign: "start", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colTaxability")}
              </th>
              <th style={{ textAlign: "center", padding: "8px 10px", color: "var(--mut)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("colActive")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, idx) => {
              const taxability = getTaxability(c.code, c.isTaxable);
              const isEnabled = enabled[c.id] ?? true;
              return (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    opacity: isEnabled ? 1 : 0.45,
                    background: idx % 2 === 0 ? "transparent" : "var(--line2, rgba(0,0,0,0.02))",
                  }}
                >
                  <td style={{ padding: "10px 10px" }}>
                    <code
                      style={{
                        background: "var(--line2)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: "var(--ink)",
                      }}
                    >
                      {c.code}
                    </code>
                  </td>
                  <td style={{ padding: "10px 10px", fontWeight: 500, color: "var(--ink)" }}>
                    {c.name}
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <TypeBadge type={c.componentType} />
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "center" }}>
                    <FormulaTooltip code={c.code} />
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <TaxabilityBadge taxability={taxability} />
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "center" }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={isEnabled ? t("disableComponentAriaLabel", { name: c.name }) : t("enableComponentAriaLabel", { name: c.name })}
                      onClick={() => setEnabled((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: 36,
                        height: 20,
                        borderRadius: 20,
                        background: isEnabled ? "var(--good, #10b981)" : "var(--mut, #94a3b8)",
                        border: "none",
                        cursor: "pointer",
                        transition: "background 0.2s",
                        padding: "2px 3px",
                        justifyContent: isEnabled ? "flex-end" : "flex-start",
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: "var(--panel, #fff)",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          transition: "transform 0.2s",
                        }}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
