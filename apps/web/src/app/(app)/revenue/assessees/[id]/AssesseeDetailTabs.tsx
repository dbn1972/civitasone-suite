"use client";

import { useState } from "react";
import { DataTable, Tabs, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export type DcbSummary = { totalDemand: string; totalCollected: string; balance: string };

export type DemandRow = {
  id: string;
  financialYear: string;
  dueDate: string;
  principalMinor: string | number;
  rebateMinor: string | number;
  penaltyMinor: string | number;
  interestMinor: string | number;
  netMinor: string | number;
  status: string;
} & Record<string, unknown>;

export type BillRow = {
  id: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  principalMinor: string | number;
  penaltyMinor: string | number;
  totalMinor: string | number;
  status: string;
} & Record<string, unknown>;

export type ReceiptRow = {
  id: string;
  receiptNo: string | null;
  channel: string;
  amountMinor: string | number;
  status: string;
  reconciled: boolean;
  createdAt: string;
} & Record<string, unknown>;

export type InstalmentPlanRow = {
  id: string;
  totalMinor: string | number;
  instalmentCount: number;
  startDate: string;
  status: string;
} & Record<string, unknown>;

const TABS = ["DCB", "Demands", "Bills", "Receipts", "Instalment Plans"] as const;
type TabKey = (typeof TABS)[number];

export function AssesseeDetailTabs({
  dcb,
  dcbErrored = false,
  demands,
  demandsErrored = false,
  bills,
  billsErrored = false,
  receipts,
  receiptsErrored = false,
  instalmentPlans,
  instalmentsErrored = false,
}: {
  dcb: DcbSummary | null;
  dcbErrored?: boolean;
  demands: DemandRow[];
  demandsErrored?: boolean;
  bills: BillRow[];
  billsErrored?: boolean;
  receipts: ReceiptRow[];
  receiptsErrored?: boolean;
  instalmentPlans: InstalmentPlanRow[];
  instalmentsErrored?: boolean;
}) {
  const [active, setActive] = useState<TabKey>("DCB");

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => setActive(t as TabKey)} />

      {active === "DCB" && (
        <div className="pad" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          {dcbErrored ? (
            <RefreshErrorState error={toHumanError("load", { area: "the demand-collection-balance" })} />
          ) : dcb === null ? (
            <p style={{ color: "var(--ink2)", fontSize: 13 }}>No demand-collection-balance entries yet.</p>
          ) : (
            <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <dt>Total Demand</dt>
                <dd className="mono">{formatMoney(dcb.totalDemand)}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <dt>Total Collected</dt>
                <dd className="mono">{formatMoney(dcb.totalCollected)}</dd>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                <dt>Balance</dt>
                <dd className="mono">{formatMoney(dcb.balance)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {active === "Demands" && (
        demandsErrored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "demands" })} /></div>
        ) : (
        <DataTable<DemandRow>
          columns={[
            { key: "financialYear", label: "FY" },
            { key: "dueDate", label: "Due Date", render: (r) => formatIndianDate(r.dueDate) },
            { key: "principalMinor", label: "Principal", align: "right", cellType: "amount" },
            { key: "penaltyMinor", label: "Penalty", align: "right", cellType: "amount" },
            { key: "interestMinor", label: "Interest", align: "right", cellType: "amount" },
            { key: "netMinor", label: "Net Demand", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={demands}
          sortable
          pageSize={10}
          emptyIcon="📄"
          emptyTitle="No demands raised"
          emptyMessage="Demands appear once an assessment is created for this assessee."
        />
        )
      )}

      {active === "Bills" && (
        billsErrored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "bills" })} /></div>
        ) : (
        <DataTable<BillRow>
          columns={[
            { key: "billNo", label: "Bill No." },
            { key: "billDate", label: "Bill Date", render: (r) => formatIndianDate(r.billDate) },
            { key: "dueDate", label: "Due Date", render: (r) => formatIndianDate(r.dueDate) },
            { key: "principalMinor", label: "Principal", align: "right", cellType: "amount" },
            { key: "penaltyMinor", label: "Penalty", align: "right", cellType: "amount" },
            { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={bills}
          sortable
          pageSize={10}
          emptyIcon="🧾"
          emptyTitle="No bills generated"
          emptyMessage="Bills are generated from raised demands."
        />
        )
      )}

      {active === "Receipts" && (
        receiptsErrored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "receipts" })} /></div>
        ) : (
        <DataTable<ReceiptRow>
          columns={[
            { key: "receiptNo", label: "Receipt No.", render: (r) => r.receiptNo ?? "—" },
            { key: "channel", label: "Channel" },
            { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
            {
              key: "reconciled",
              // GAP-REVENUE-ASSESSEES-DETAIL-04: this is BANK reconciliation
              // (does the receipt match a bank statement line), distinct from the
              // receipt's own lifecycle Status. Name it explicitly and render a
              // pill so the two columns don't read as duplicates.
              label: "Bank reconciled",
              render: (r) => (
                <span title="Whether this receipt has been matched to a bank statement line (bank reconciliation), separate from the receipt's own status.">
                  {r.reconciled ? "Reconciled" : "Pending"}
                </span>
              ),
            },
            { key: "status", label: "Status", cellType: "status" },
            { key: "createdAt", label: "Received", render: (r) => formatIndianDate(r.createdAt) },
          ]}
          rows={receipts}
          sortable
          pageSize={10}
          emptyIcon="🧮"
          emptyTitle="No receipts recorded"
          emptyMessage="Payment receipts against this assessee's demands will appear here."
        />
        )
      )}

      {active === "Instalment Plans" && (
        instalmentsErrored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "instalment plans" })} /></div>
        ) : (
        <DataTable<InstalmentPlanRow>
          columns={[
            { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
            { key: "instalmentCount", label: "Instalments", align: "right" },
            { key: "startDate", label: "Start Date", render: (r) => formatIndianDate(r.startDate) },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={instalmentPlans}
          sortable
          pageSize={10}
          emptyIcon="📆"
          emptyTitle="No instalment plans"
          emptyMessage="Arrears instalment plans for this assessee will appear here."
        />
        )
      )}
    </div>
  );
}
