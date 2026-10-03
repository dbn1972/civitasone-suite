"use client";

import { DataTable } from "@/app/_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import type { DepositEvent } from "./depositDetail";

/** Ledger of a deposit (GAP-FINANCE-TREASURY-DEPOSITS-03). A client component because DataTable's render props cannot cross the server boundary. */
export function DepositLedgerTable({ events }: { events: DepositEvent[] }) {
  return (
    <DataTable<DepositEvent>
      columns={[
        { key: "createdAt", label: "Date", cellType: "date" },
        { key: "eventType", label: "Event", render: (e) => humanizeStatus(e.eventType) },
        { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
        { key: "reference", label: "Reference", render: (e) => e.reference ?? "—" },
        {
          key: "journalId",
          label: "Voucher",
          sortable: false,
          render: (e) =>
            e.journalId ? (
              <a href={`/api/proxy/v1/finance/journals/${encodeURIComponent(e.journalId)}/pdf`} target="_blank" rel="noopener noreferrer">Open voucher</a>
            ) : "—",
        },
      ]}
      rows={events}
      pageSize={15}
      emptyIcon="🕒"
      emptyTitle="No ledger events"
      emptyMessage="No refund, forfeiture or adjustment has been recorded against this deposit."
    />
  );
}
