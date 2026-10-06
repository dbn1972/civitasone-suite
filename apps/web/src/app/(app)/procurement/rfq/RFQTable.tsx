"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";
import { formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { opaqueRefHref, parseOpaqueRef } from "@/lib/refs";
import type { RFQSummary } from "@civitasone/types";

type RFQRow = {
  id: string;
  rfqNo: string;
  title: string;
  indentRef?: string;
  indentId: string | null;
  closingDate: string;
  closingDateRaw: string;
  responsesReceived: number;
  vendorsInvited: number;
  status: RFQSummary["status"];
} & Record<string, unknown>;

const STATUS_FILTERS = ["All", "Issued", "Closed", "Awarded"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * GAP-PROCUREMENT-RFQ-03: an officer scanning for RFQs that closed with no
 * response shouldn't have to sort by hand. For an *issued* RFQ whose closing
 * date is today or past (compared in IST, never browser-local), surface an
 * "Overdue" cue, and specifically flag the zero-response case the officer is
 * hunting for. Closed/awarded RFQs are terminal and never "overdue".
 */
function closingCue(status: RFQSummary["status"], closingDateRaw: string, responses: number): string | null {
  if (status !== "issued") return null;
  const days = daysUntilIST(closingDateRaw);
  if (days === null || days > 0) return null;
  return responses === 0 ? "Overdue · no responses" : "Overdue";
}

export function RFQTable({ rfqs }: { rfqs: RFQSummary[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  const allRows = useMemo<RFQRow[]>(
    () =>
      rfqs.map((r) => {
        const parsed = parseOpaqueRef(r.indentRef);
        return {
          id: r.id,
          rfqNo: r.rfqNo,
          title: r.title,
          indentRef: r.indentRef,
          // GAP-PROCUREMENT-RFQ-02: resolve the opaque "procurement_indent:UUID"
          // ref to an id for linking; never print the raw ref.
          indentId: parsed?.id ?? null,
          closingDate: formatIndianDate(r.closingDate),
          closingDateRaw: r.closingDate,
          responsesReceived: r.responsesReceived,
          vendorsInvited: r.vendorsInvited,
          status: r.status,
        };
      }),
    [rfqs],
  );

  const rows = useMemo<RFQRow[]>(() => {
    if (statusFilter === "All") return allRows;
    const want = statusFilter.toLowerCase();
    return allRows.filter((r) => r.status === want);
  }, [allRows, statusFilter]);

  return (
    <Card title="Requests for quotation">
      <div style={{ padding: "8px 0 12px" }}>
        <Segmented
          options={[...STATUS_FILTERS]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="📝"
          title={statusFilter === "All" ? "No RFQs found" : `No ${statusFilter.toLowerCase()} RFQs`}
          message={
            statusFilter === "All"
              ? "Create a new RFQ to start collecting vendor quotes."
              : "No RFQs match this status filter."
          }
          action={<Link href="/procurement/rfq/new" className="btn primary">+ New RFQ</Link>}
        />
      ) : (
        <DataTable<RFQRow>
          rows={rows}
          rowLinkKey="id"
          rowLinkPrefix="/procurement/rfq/"
          identifyingColumnKey="rfqNo"
          sortable
          filterable
          filterKeys={["rfqNo", "title", "status"]}
          filterPlaceholder="Filter by RFQ no, title, status…"
          pageSize={10}
          columns={[
            { key: "rfqNo", label: "RFQ No" },
            { key: "title", label: "Title" },
            {
              key: "indentRef",
              label: "Indent Ref",
              // GAP-PROCUREMENT-RFQ-02: link to the indent; never show the raw
              // "procurement_indent:<uuid>" string. "—" when absent/malformed.
              render: (row) => {
                const href = opaqueRefHref(row.indentRef);
                if (!href || !row.indentId) return "—";
                return (
                  <Link href={href} onClick={(e) => e.stopPropagation()}>
                    View indent
                  </Link>
                );
              },
              csv: (row) => row.indentId ?? "—",
            },
            { key: "vendorsInvited", label: "Invited", align: "right" },
            { key: "responsesReceived", label: "Responses", align: "right" },
            { key: "closingDate", label: "Closing Date" },
            {
              key: "status",
              label: "Status",
              // GAP-PROCUREMENT-RFQ-03/04: status pill plus an IST-computed
              // overdue cue (text, not colour alone) for issued-but-past RFQs.
              render: (row) => {
                const cue = closingCue(row.status, row.closingDateRaw, row.responsesReceived);
                return (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusPill status={row.status} />
                    {cue ? <StatusPill status="overdue" label={cue} /> : null}
                  </span>
                );
              },
              csv: (row) => row.status,
            },
          ]}
        />
      )}
    </Card>
  );
}
