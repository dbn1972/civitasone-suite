"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { StatusPill, Button } from "../../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

/**
 * One F&F settlement as payroll-service's GET /v1/payroll/fnf/settlements
 * actually returns it (fnf/routes.ts serializeSettlement). Money fields are
 * paise as decimal strings (bigint on the server) -- never coerced with
 * Number() here.
 *
 * GAP-PAYROLL-FNF-06: this type used to declare lastSalaryMinor /
 * gratuityMinor / leaveEncashmentMinor / bonusArrearsMinor / deductionsMinor,
 * none of which the API sends -- so the breakdown was always empty. It now
 * mirrors the real component fields.
 */
export type FnFCardRow = {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  separationType: string;
  separationDate: string;
  status: string;
  netPayableMinor: string | number;
  noticeBuyoutMinor?: string | number | null;
  leaveEncashmentGrossMinor?: string | number | null;
  gratuityGrossMinor?: string | number | null;
  retrenchmentCompMinor?: string | number | null;
  vrsCompMinor?: string | number | null;
  arrearsMinor?: string | number | null;
  tdsOnSeparationMinor?: string | number | null;
  gratuityExemptMinor?: string | number | null;
  leaveEncashExemptMinor?: string | number | null;
};

type Money = string | number | null | undefined;

const SEPARATION_TYPE_KEYS: Record<string, string> = {
  retirement: "separationTypeRetirement",
  superannuation: "separationTypeSuperannuation",
  resignation: "separationTypeResignation",
  retrenchment: "separationTypeRetrenchment",
  vrs: "separationTypeVrs",
  death: "separationTypeDeath",
};

/** Paise as bigint, or null when the value is missing/unparseable. */
function toMinor(v: Money): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return typeof v === "number" ? BigInt(Math.round(v)) : BigInt(v.trim());
  } catch {
    return null;
  }
}

/**
 * GAP-PAYROLL-FNF-06: footing check. payroll-service computes
 * netPayable = (noticeBuyout + leaveEncashmentGross + gratuityGross +
 * retrenchmentComp + vrsComp + arrears) - tdsOnSeparation (fnf/domain.ts).
 * Returns true when the displayed rows sum to the displayed net payable.
 */
export function settlementFoots(row: FnFCardRow): boolean {
  const gross = [row.noticeBuyoutMinor, row.leaveEncashmentGrossMinor, row.gratuityGrossMinor, row.retrenchmentCompMinor, row.vrsCompMinor, row.arrearsMinor]
    .reduce<bigint>((s, v) => s + (toMinor(v) ?? 0n), 0n);
  const tds = toMinor(row.tdsOnSeparationMinor) ?? 0n;
  const net = toMinor(row.netPayableMinor);
  return net !== null && gross - tds === net;
}

function FnFCard({ row }: { row: FnFCardRow }) {
  const t = useTranslations("fnFSettlementCard");
  const tf = useTranslations("computeFnfForm");
  const [expanded, setExpanded] = useState(false);

  // GAP-PAYROLL-FNF-06: every component row is shown, including zeros
  // (formatMoney renders "₹0.00" for 0 and "—" for a missing value), and
  // the single "Deductions" line is replaced by the one deduction the
  // service actually computes: TDS on separation.
  const earnings: { key: string; label: string; amount: Money }[] = [
    { key: "notice", label: t("noticeBuyoutLabel"), amount: row.noticeBuyoutMinor },
    { key: "leave", label: t("leaveEncashmentLabel"), amount: row.leaveEncashmentGrossMinor },
    { key: "gratuity", label: t("gratuityLabel"), amount: row.gratuityGrossMinor },
    { key: "retrenchment", label: t("retrenchmentCompLabel"), amount: row.retrenchmentCompMinor },
    { key: "vrs", label: t("vrsCompLabel"), amount: row.vrsCompMinor },
    { key: "arrears", label: t("arrearsLabel"), amount: row.arrearsMinor },
  ];
  const foots = settlementFoots(row);

  const separationKey = SEPARATION_TYPE_KEYS[row.separationType];
  const separationLabel = separationKey ? tf(separationKey) : row.separationType;
  // GAP-PAYROLL-FNF-05: never print the raw employee UUID -- the name and
  // HR employee number come from payroll-service's hrms enrichment.
  const name = row.employeeName ?? t("unknownEmployee");
  const meta = [row.employeeCode, separationLabel, formatIndianDate(row.separationDate)].filter(Boolean).join(" · ");

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ background: "var(--panel)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{meta}</div>
        </div>
        <StatusPill status={row.status} />
      </div>

      <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("netPayableLabel")}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{formatMoney(row.netPayableMinor)}</div>
        </div>
        <Button
          variant="ghost"
          style={{ fontSize: 12, minHeight: 30 }}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? t("hideBreakdownBtn") : t("showBreakdownBtn")}
        </Button>
      </div>

      {expanded && (
        <div style={{ padding: "0 18px 16px", borderTop: "1px solid var(--line2)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
            <tbody>
              {earnings.map((c) => (
                <tr key={c.key} style={{ borderBottom: "1px solid var(--line2)" }}>
                  <th scope="row" style={{ padding: "7px 0", color: "var(--ink2)", fontWeight: 400, textAlign: "start" }}>{c.label}</th>
                  <td style={{ padding: "7px 0", textAlign: "end", fontWeight: 600 }}>{formatMoney(c.amount)}</td>
                </tr>
              ))}
              <tr style={{ borderBottom: "1px solid var(--line2)" }}>
                <th scope="row" style={{ padding: "7px 0", color: "var(--bad, #c0392b)", fontWeight: 400, textAlign: "start" }}>{t("tdsOnSeparationLabel")}</th>
                <td style={{ padding: "7px 0", textAlign: "end", fontWeight: 600, color: "var(--bad, #c0392b)" }}>
                  {toMinor(row.tdsOnSeparationMinor) === null ? "—" : `−${formatMoney(row.tdsOnSeparationMinor)}`}
                </td>
              </tr>
              <tr style={{ borderTop: "2px solid var(--line2)" }}>
                <th scope="row" style={{ padding: "8px 0", fontWeight: 700, textAlign: "start" }}>{t("netPayableLabel")}</th>
                <td style={{ padding: "8px 0", textAlign: "end", fontWeight: 700 }}>{formatMoney(row.netPayableMinor)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink2)" }}>
            {t("exemptionsNote", { gratuity: formatMoney(row.gratuityExemptMinor), leave: formatMoney(row.leaveEncashExemptMinor) })}
          </p>
          {!foots && (
            <p role="note" className="pill warn" style={{ width: "fit-content", marginTop: 8 }}>{t("footingWarning")}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function FnFSettlementCards({ rows }: { rows: FnFCardRow[] }) {
  const t = useTranslations("fnFSettlementCard");

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🧮</p>
        <p style={{ fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ fontSize: 13 }}>{t("emptyMessage")}</p>
      </div>
    );
  }

  return (
    <>
      {/* GAP-PAYROLL-FNF-01/02: the per-card "Submit for Approval" / "Finance
          Approve" / "Mark Disbursed" buttons POSTed to
          /v1/payroll/fnf/settlements/:id/{submit,finance-approve,disburse},
          none of which exist in payroll-service (fnf/routes.ts has only
          compute + read routes), so every click failed -- and with no role
          or maker-checker control. They are removed until a real approval /
          payment workflow exists server-side; this note says so honestly. */}
      <p role="note" style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 12px" }}>{t("workflowUnavailableNote")}</p>
      <div style={{ display: "grid", gap: 14 }}>
        {rows.map((row) => (
          <FnFCard key={row.id} row={row} />
        ))}
      </div>
    </>
  );
}
