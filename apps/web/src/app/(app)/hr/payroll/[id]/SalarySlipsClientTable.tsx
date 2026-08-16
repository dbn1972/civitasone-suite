"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/formatters";
import { StatusPill } from "@/app/_components/ds";

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

/** Estimate GoI 7th-CPC component breakdown from gross. */
function estimateComponents(gross: number) {
  const basic   = Math.round(gross * 0.45);
  const da      = Math.round(basic * 0.46);   // 46% DA
  const hra     = Math.round(basic * 0.24);   // 24% HRA (X-city)
  const ta      = 3600;                        // Transport Allowance (fixed)
  const special = Math.max(0, gross - basic - da - hra - ta);

  const pf      = Math.round(basic * 0.12);   // 12% EPF employee share
  const esi     = Math.round(gross * 0.0075); // 0.75% ESI employee share
  const pt      = 200;                        // Professional Tax
  const tds     = Math.max(0, Math.round((gross - pf - esi - pt) * 0.05));

  const totalDed = pf + esi + pt + tds;
  return { basic, da, hra, ta, special, pf, esi, pt, tds, totalDed };
}

function SlipRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <tr>
      <td
        style={{
          padding: "5px 0",
          color: bold ? "var(--fg,#0f172a)" : "var(--sub,#475569)",
          fontWeight: bold ? 700 : 400,
          borderBottom: "1px solid var(--line,#f1f5f9)",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "5px 0",
          textAlign: "right",
          fontWeight: bold ? 700 : 400,
          borderBottom: "1px solid var(--line,#f1f5f9)",
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
          color: "var(--mut,#64748b)",
          marginBottom: 4,
          paddingBottom: 4,
          borderBottom: "1px solid var(--line,#e2e8f0)",
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
  const c = estimateComponents(slip.gross);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slip-dlg-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.42)",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface,#fff)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 520,
          maxHeight: "92vh",
          overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line,#e2e8f0)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div id="slip-dlg-title" style={{ fontWeight: 700, fontSize: 15 }}>
              Pay Slip — {payPeriod}
            </div>
            <div style={{ fontSize: 11, color: "var(--mut,#64748b)", marginTop: 2 }}>
              Government of India — Indicative slip (pre-disbursement)
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pay slip preview"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "var(--mut,#64748b)",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Employee info */}
        <div
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--line,#e2e8f0)",
            background: "var(--panel,#f8fafc)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>{slip.employeeName}</div>
          <div style={{ fontSize: 11, color: "var(--mut,#64748b)", marginTop: 2 }}>
            Employee ID: {slip.employeeId} · Period: {payPeriod}
          </div>
        </div>

        {/* Slip body */}
        <div style={{ padding: "14px 20px" }}>
          <SlipSection title="Earnings">
            <SlipRow label="Basic Pay"                    value={c.basic}   />
            <SlipRow label="Dearness Allowance (DA) @46%" value={c.da}      />
            <SlipRow label="House Rent Allowance (HRA)"   value={c.hra}     />
            <SlipRow label="Transport Allowance"          value={c.ta}      />
            <SlipRow label="Special Allowance"            value={c.special} />
            <SlipRow label="Gross Earnings"               value={slip.gross} bold />
          </SlipSection>

          <SlipSection title="Deductions">
            <SlipRow label="Provident Fund (EPF) — 12%"  value={c.pf}      />
            <SlipRow label="ESI (Employee) — 0.75%"      value={c.esi}     />
            <SlipRow label="Professional Tax (PT)"       value={c.pt}      />
            <SlipRow label="Income Tax (TDS)"            value={c.tds}     />
            <SlipRow label="Total Deductions"            value={c.totalDed} bold />
          </SlipSection>

          {/* Net Pay */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 0 4px",
              borderTop: "2px solid var(--primary,#2563eb)",
              marginTop: 2,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>Net Pay</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: "var(--primary,#2563eb)" }}>
              {formatRupees(slip.net)}
            </span>
          </div>
        </div>

        <div
          style={{
            padding: "6px 20px 14px",
            fontSize: 10,
            color: "var(--mut,#94a3b8)",
            borderTop: "1px solid var(--line,#e2e8f0)",
          }}
        >
          System-generated indicative slip. Component breakdown is estimated; final figures
          per pay order issued by DDO. Ref: 7th CPC pay matrix &amp; FR 8.
        </div>
      </div>
    </div>
  );
}

// ─── Salary Slips Table ────────────────────────────────────────────────────

type TableProps = {
  slips: SlipRow[];
  payPeriod: string;
  exceptionCount: number;
  onRunPayroll?: () => void;
};

const btnBase: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--line,#e2e8f0)",
  cursor: "pointer",
  background: "var(--surface,#fff)",
};

export function SalarySlipsClientTable({
  slips,
  payPeriod,
  exceptionCount,
}: TableProps) {
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
    textAlign: "left",
    fontWeight: 600,
    borderBottom: "1px solid var(--line,#e2e8f0)",
    color: "#64748b",
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
          placeholder="Filter by employee or status…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter salary slips"
          style={{
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid var(--line,#cbd5e1)",
            borderRadius: 8,
            minWidth: 220,
            flex: 1,
            maxWidth: 360,
          }}
        />
        <button
          type="button"
          disabled={exceptionCount > 0}
          title={
            exceptionCount > 0
              ? `${exceptionCount} exception${exceptionCount !== 1 ? "s" : ""} must be resolved first`
              : "Run payroll for all employees"
          }
          style={{
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 700,
            borderRadius: 8,
            border: "none",
            cursor: exceptionCount > 0 ? "not-allowed" : "pointer",
            background: exceptionCount > 0 ? "var(--mut,#94a3b8)" : "var(--primary,#2563eb)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Run Payroll
          {exceptionCount > 0 && (
            <span
              aria-label={`${exceptionCount} exceptions`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#dc2626",
                color: "#fff",
                borderRadius: "50%",
                width: 18,
                height: 18,
                fontSize: 10,
                fontWeight: 700,
                marginLeft: 2,
              }}
            >
              {exceptionCount}
            </span>
          )}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={thStyle}>Employee</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Gross</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Deductions</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Net</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", color: "var(--mut,#64748b)" }}>
                  No salary slips match your filter.
                </td>
              </tr>
            ) : (
              paged.map((slip) => (
                <tr key={slip.id} style={{ borderBottom: "1px solid var(--line,#f1f5f9)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 500 }}>{slip.employeeName}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatRupees(slip.gross)}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatRupees(slip.deductions)}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {formatRupees(slip.net)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <StatusPill status={slip.status} />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button
                      type="button"
                      onClick={() => setPreview(slip)}
                      style={{
                        ...btnBase,
                        borderColor: "var(--primary,#2563eb)",
                        color: "var(--primary,#2563eb)",
                        fontWeight: 600,
                      }}
                    >
                      Preview Slip
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalVisible > SLIP_PAGE && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", fontSize: 13 }}>
            <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              {"←"} Previous
            </button>
            <span style={{ color: "var(--ink2)" }}>
              {page * SLIP_PAGE + 1}–{Math.min((page + 1) * SLIP_PAGE, totalVisible)} of {totalVisible}
            </span>
            <button className="btn" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * SLIP_PAGE >= totalVisible}>
              Next {"→"}
            </button>
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
