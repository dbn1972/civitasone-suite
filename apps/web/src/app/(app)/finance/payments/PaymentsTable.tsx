"use client";

import { useState, useMemo } from "react";
import { Card, DataTable, Segmented } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Payment = {
  id?: string;
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  status: string;
};

type Row = {
  id?: string;
  reference: string;
  beneficiary: string;
  amountDisplay: string;
  status: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatReference(ref: string): string {
  if (UUID_RE.test(ref)) {
    return "PAY-" + ref.slice(-6).toUpperCase();
  }
  return ref;
}

const TABS = ["All", "Pending", "Released"] as const;
type Tab = (typeof TABS)[number];

export function PaymentsTable({ payments, source = "api" }: { payments: Payment[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Payment[]>(
    "finance.payments",
    payments,
    source,
    (d) => d.length === 0,
  );

  const filtered = rows.filter((p) => {
    if (activeTab === "Pending") return p.status === "Pending Approval";
    if (activeTab === "Released") return p.status === "Released";
    return true;
  });

  const tableRows: Row[] = useMemo(
    () =>
      filtered.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        reference: formatReference(p.referenceId),
        beneficiary: p.beneficiary,
        amountDisplay: p.amountDisplay,
        status: p.status,
      })),
    [filtered],
  );

  return (
    <Card
      title="Payments register"
      link={
        <Segmented
          options={[...TABS]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
        />
      }
    >
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "reference", label: "Reference" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amountDisplay", label: "Amount", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={tableRows}
        // Open the payment detail (UTR, submit-for-approval) — only for rows
        // that carry a real id; id-less rows stay non-clickable (no dead link).
        rowHref={(row) => (row.id ? `/finance/payments/${row.id}` : "")}
        sortable
        filterable
        filterPlaceholder="Search payments…"
        pageSize={15}
      />
    </Card>
  );
}
