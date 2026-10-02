"use client";
import { DataTable, StatGrid, StatCard, StatusPill, Card, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import type { FinanceAuditParaSummary } from "@civitasone/types";
import { auditParaTone } from "./auditParaTone";
import { auditParaStats } from "./auditParaStats";
type Row = FinanceAuditParaSummary;
export function AuditParasTable({ paras, source = "api" }: { paras: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.audit-paras", paras, source, (d) => d.length === 0);

  // GAP-FINANCE-AUDIT-PARAS-02: a failed load with nothing cached must not read
  // as a clean audit record (zeros + "No CAG audit observations found").
  if (provenance === "error-no-data") {
    return <RefreshErrorState error={toHumanError("load", { area: "audit paras" })} backHref="/finance" />;
  }

  const stats = auditParaStats(rows);
  return (
    <>
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Paras" value={stats.total} />
        <StatCard icon="🔴" iconBg="#fce7ee" label="Open" value={stats.open} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Responded" value={stats.responded} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={stats.settled} />
      </StatGrid>
      <Card title="Audit Observations">
        {/* UX-012: this badge is the ONLY place that reports data provenance for
            the rows shown below — it reads the same useSeededResource call as
            `rows`, so it can never disagree with what the table shows. */}
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <DataTable<Row>
          columns={[
            { key: "paraNo", label: "Para No" },
            { key: "source", label: "Source" },
            { key: "dept", label: "Department" },
            { key: "moneyValueMinor", label: "Amount", align: "right", cellType: "amount" },
            { key: "createdAt", label: "Raised", cellType: "date" },
            {
              key: "status",
              label: "Status",
              render: (r) => <StatusPill status={r.status} variant={auditParaTone(r.status)} />,
            },
          ]}
          rows={rows}
          rowLinkKey="id"
          rowLinkPrefix="/finance/audit-paras/"
          sortable
          filterable
          filterPlaceholder="Search audit paras…"
          pageSize={15}
          exportable
          exportFilename="audit-paras"
          emptyIcon="📋"
          emptyTitle="No audit paras"
          emptyMessage="No CAG audit observations found."
        />
      </Card>
    </>
  );
}
