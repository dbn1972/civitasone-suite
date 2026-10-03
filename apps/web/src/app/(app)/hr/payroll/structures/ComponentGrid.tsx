"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/formatters";

interface ComponentRow {
  id: string;
  code: string;
  name: string;
  componentType: string;
  isTaxable: boolean;
  structureId?: string | null;
  /** configured calculation rule (GAP-PAYROLL-STRUCTURES-03); all null = none configured */
  formula?: string | null;
  pctOfBasic?: string | number | null;
  fixedMinor?: string | null;
}

interface ComponentGridProps {
  components: ComponentRow[];
}

type Taxability = "Taxable" | "NotMarked";

// GAP-PAYROLL-STRUCTURES-03: this used to override the API's own isTaxable
// for any code containing HRA/LTA/MEDICAL/TA/TRANSPORT/NPS/GPF/PF/EPF/
// GRATUITY/DA/DEARNESS/BASIC, as a three-way "Taxable/Exempt/Partially
// Exempt" classification -- but the API only ever returns a plain boolean
// isTaxable, nothing supports a partial-exemption tier, and the substring
// matching was wrong on its own terms (`includes("TA")` matches
// DEPUTATION_ALLOWANCE, DATA_ENTRY, any code containing "DA" matches
// "Dearness Allowance" fine but also anything else with those two letters).
// A wrong tax-exempt label here can mislead payroll admins into
// mis-configuring TDS -- trust the API's own field, full stop.
//
// payroll_components.is_taxable is NOT NULL DEFAULT false and no API writes
// it, so `false` means "nobody marked it taxable", NOT "exempt" (the dev
// seed stores Basic Pay as false, and basic pay is fully taxable salary under
// s.15/17(1)). Render it as a neutral "not marked" state, never as a green
// exemption claim; whether an allowance is (partly) exempt is a TDS-engine /
// declaration question this flag cannot answer.
function getTaxability(isTaxable: boolean): Taxability {
  return isTaxable ? "Taxable" : "NotMarked";
}

const TAXABILITY_STYLE: Record<Taxability, { background: string; color: string; border: string }> = {
  Taxable: { background: "var(--badbg)", color: "var(--bad)", border: "1px solid var(--badbd)" },
  NotMarked: { background: "var(--line2)", color: "var(--mut)", border: "1px solid var(--line)" },
};

// UX-017: keys are the stable Taxability discriminant values, never
// translated directly -- only used to look up the display label and style.
const TAXABILITY_LABEL_KEYS: Record<Taxability, string> = {
  Taxable: "taxabilityTaxable",
  NotMarked: "taxabilityNotMarked",
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

export type ComponentRule = Pick<ComponentRow, "formula" | "pctOfBasic" | "fixedMinor">;

/**
 * GAP-PAYROLL-STRUCTURES-03: only what the API returns for THIS component is
 * described -- no rates of our own. Empty => nothing configured.
 */
export function describeRule(rule: ComponentRule): Array<{ kind: "rulePctOfBasic" | "ruleFixed" | "ruleFormula"; values: Record<string, string> }> {
  const out: Array<{ kind: "rulePctOfBasic" | "ruleFixed" | "ruleFormula"; values: Record<string, string> }> = [];
  const pct = rule.pctOfBasic == null || rule.pctOfBasic === "" ? null : String(Number(rule.pctOfBasic));
  if (pct !== null && pct !== "NaN") out.push({ kind: "rulePctOfBasic", values: { pct } });
  if (rule.fixedMinor != null && /^\d+$/.test(rule.fixedMinor)) out.push({ kind: "ruleFixed", values: { amount: formatMoney(Number(rule.fixedMinor)) } });
  if (rule.formula && rule.formula.trim()) out.push({ kind: "ruleFormula", values: { formula: rule.formula.trim() } });
  return out;
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

// GAP-PAYROLL-STRUCTURES-03: the formula tooltip used to look up a
// hard-coded rate/slab string (COMPONENT_FORMULA_KEYS -> en.json, e.g.
// formulaDa "currently 46%", formulaHra "27/18/9") by a component-code
// substring match -- presented as a system fact with no source or date, and
// DA in particular is a rate FinMin revises quarterly, so it goes stale by
// design. Those keys are deleted from en/hi. payroll_components does carry
// formula / pct_of_basic / fixed_minor, but listComponents doesn't expose
// them, so the tooltip says the rule "isn't shown on this page" -- not that
// it isn't configured, which would invite needless reconfiguration.
function FormulaTooltip({ code, rule }: { code: string; rule: ComponentRule }) {
  const t = useTranslations("componentGrid");
  const lines = describeRule(rule);
  const [visible, setVisible] = useState(false);
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
          {lines.length === 0 ? (
            t("formulaNotConfigured")
          ) : (
            <>
              {lines.map((l) => <div key={l.kind}>{t(l.kind, l.values)}</div>)}
              <div style={{ opacity: 0.75, marginTop: 4 }}>{t("ruleSourceNote")}</div>
            </>
          )}
        </div>
      )}
    </span>
  );
}

export function ComponentGrid({ components }: ComponentGridProps) {
  const t = useTranslations("componentGrid");
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, idx) => {
              const taxability = getTaxability(c.isTaxable);
              return (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: "1px solid var(--line)",
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
                    <FormulaTooltip code={c.code} rule={{ formula: c.formula ?? null, pctOfBasic: c.pctOfBasic ?? null, fixedMinor: c.fixedMinor ?? null }} />
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <TaxabilityBadge taxability={taxability} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>
        {t("taxabilityNote")}
      </p>
    </div>
  );
}
