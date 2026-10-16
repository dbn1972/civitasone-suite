"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatRupees } from "@/lib/formatters";
import { Button, Modal, StatusPill } from "@/app/_components/ds";

type SlipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  gross: number;
  deductions: number;
  net: number;
  status: string;
};

// ─── Salary Slip Preview Modal ─────────────────────────────────────────────

function SlipLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <tr>
      <td
        style={{
          padding: "5px 0",
          color: bold ? "var(--fg)" : "var(--sub)",
          fontWeight: bold ? 700 : 400,
          borderBottom: "1px solid var(--line)",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "5px 0",
          textAlign: "end",
          fontWeight: bold ? 700 : 400,
          borderBottom: "1px solid var(--line)",
        }}
      >
        {formatRupees(value)}
      </td>
    </tr>
  );
}

function SlipSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          color: "var(--mut)",
          marginBottom: 4,
          paddingBottom: 4,
          borderBottom: "1px solid var(--line)",
        }}
      >
        {title}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SalarySlipModal({
  slip,
  payPeriod,
  onClose,
}: {
  slip: SlipRow;
  payPeriod: string;
  onClose: () => void;
}) {
  const t = useTranslations("salarySlipsClientTable");
  const tFallback = useTranslations("employeeFallback");
  // GAP-PAYROLL-DETAIL-01: this modal used to call a client-side
  // estimateComponents(gross) that INVENTED a Basic/DA/HRA/TA/Special
  // earnings split and an EPF/ESI/PT/TDS deductions split from percentages
  // of gross alone -- numbers with no backend source, that never
  // reconciled to the API's own slip.net, and that showed EPF/ESI lines on
  // what the header calls a Government of India slip (state employees are
  // on GPF/NPS, not EPF/ESI; ESI also has a wage ceiling the estimate
  // ignored). Only the real, API-backed figures are shown now: gross,
  // deductions and net, with an explicit check that they foot -- instead of
  // silently hiding a mismatch behind a 10px disclaimer.
  const reconciles = slip.gross - slip.deductions === slip.net;

  // SF-19: ds/Modal (focus trap, inert background, Escape, focus restore).
  return (
    <Modal open onClose={onClose} title={t("paySlipTitle", { period: payPeriod })} size="lg">
      <div style={{ maxHeight: "80vh", overflowY: "auto" }}>
        {/* Header */}
        <div
          style={{
            padding: "0 0 10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--mut)" }}>
            {t("indicativeSlipNotice")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closePreviewAriaLabel")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "var(--mut)",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Employee info -- GAP-PAYROLL-DETAIL-01: the raw employee UUID
            used to be printed here; the employee's name (already shown
            above) is the identifying information a person needs. */}
        <div
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>{slip.employeeName?.trim() || tFallback("unknownEmployee")}</div>
          <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 2 }}>
            {t("employeeIdPeriodLine", { period: payPeriod })}
          </div>
        </div>

        {/* Slip body -- only API-backed figures (see GAP-PAYROLL-DETAIL-01). */}
        <div style={{ padding: "14px 20px" }}>
          <SlipSection title={t("earningsSectionTitle")}>
            <SlipLine label={t("grossEarningsLabel")} value={slip.gross} bold />
          </SlipSection>

          <SlipSection title={t("deductionsSectionTitle")}>
            <SlipLine label={t("totalDeductionsLabel")} value={slip.deductions} bold />
          </SlipSection>

          {!reconciles && (
            <p role="alert" style={{ fontSize: 11.5, color: "var(--danger)", margin: "0 0 10px" }}>
              {t("grossNetMismatchWarning")}
            </p>
          )}

          {/* Net Pay */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 0 4px",
              borderTop: "2px solid var(--primary)",
              marginTop: 2,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>{t("netPayLabel")}</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: "var(--primary)" }}>
              {formatRupees(slip.net)}
            </span>
          </div>
        </div>

        <div
          style={{
            padding: "6px 20px 14px",
            fontSize: 10,
            color: "var(--mut)",
            borderTop: "1px solid var(--line)",
          }}
        >
          {t("slipFooterNotice")}
        </div>
      </div>
    </Modal>
  );
}

// ─── Salary Slips Table ────────────────────────────────────────────────────

type TableProps = {
  slips: SlipRow[];
  payPeriod: string;
};

export function SalarySlipsClientTable({
  slips,
  payPeriod,
}: TableProps) {
  const t = useTranslations("salarySlipsClientTable");
  const tFallback = useTranslations("employeeFallback");
  const [preview, setPreview] = useState<SlipRow | null>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const SLIP_PAGE = 50;

  const visible = filter
    ? slips.filter(
        (s) =>
          s.employeeName.toLowerCase().includes(filter.toLowerCase()) ||
          s.status.toLowerCase().includes(filter.toLowerCase()),
      )
    : slips;
  const totalVisible = visible.length;
  const paged = visible.slice(page * SLIP_PAGE, (page + 1) * SLIP_PAGE);

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "start",
    fontWeight: 600,
    borderBottom: "1px solid var(--line)",
    color: "var(--mut)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  };

  return (
    <>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "10px 0",
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          placeholder={t("filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("filterAriaLabel")}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid var(--line)",
            borderRadius: 8,
            minWidth: 220,
            flex: 1,
            maxWidth: 360,
          }}
        />

      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("colEmployee")}</th>
              <th style={{ ...thStyle, textAlign: "end" }}>{t("colGross")}</th>
              <th style={{ ...thStyle, textAlign: "end" }}>{t("colDeductions")}</th>
              <th style={{ ...thStyle, textAlign: "end" }}>{t("colNet")}</th>
              <th style={thStyle}>{t("colStatus")}</th>
              <th style={{ ...thStyle }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", color: "var(--mut)" }}>
                  {t("noSlipsMatchFilter")}
                </td>
              </tr>
            ) : (
              paged.map((slip) => (
                <tr key={slip.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 500 }}>{slip.employeeName?.trim() || tFallback("unknownEmployee")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                    {formatRupees(slip.gross)}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                    {formatRupees(slip.deductions)}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "end", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {formatRupees(slip.net)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <StatusPill status={slip.status} />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Button variant="ghost" size="sm" onClick={() => setPreview(slip)}>
                      {t("previewSlipBtn")}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalVisible > SLIP_PAGE && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", fontSize: 13 }}>
            <Button variant="ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              {t("previousBtn")}
            </Button>
            <span style={{ color: "var(--ink2)" }}>
              {t("paginationRangeSummary", { start: page * SLIP_PAGE + 1, end: Math.min((page + 1) * SLIP_PAGE, totalVisible), total: totalVisible })}
            </span>
            <Button variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * SLIP_PAGE >= totalVisible}>
              {t("nextBtn")}
            </Button>
          </div>
        )}
      </div>

      {preview && (
        <SalarySlipModal
          slip={preview}
          payPeriod={payPeriod}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
