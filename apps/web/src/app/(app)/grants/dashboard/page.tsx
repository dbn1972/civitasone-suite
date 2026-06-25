import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantsDashboard, getGrants } from "../../../_data/loaders";
import type { GrantSummary } from "@civitasone/types";

// Server-safe column config: no `render` fns (those cannot cross the
// Server→Client boundary). Money uses cellType:"amount" (routes through
// formatMoney) and status uses cellType:"status" (renders StatusPill).
const columns: {
  key: keyof GrantSummary & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  sortable?: boolean;
}[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "title", label: "Title" },
  { key: "granteeName", label: "Grantee" },
  { key: "totalAmount", label: "Total Amount", align: "right", cellType: "amount" },
  { key: "disbursedAmount", label: "Disbursed", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function GrantsDashboardPage() {
  const [dashResult, grantsResult] = await Promise.all([
    getGrantsDashboard(),
    getGrants(),
  ]);

  const { data, source } = dashResult;
  const grants = grantsResult.data;
  const anyError = source === "error" || grantsResult.source === "error";

  const activeGrants = grants.filter((g) => g.status === "active").length;
  const sanctionedTotal = grants.reduce((s, g) => s + g.totalAmount, 0);

  return (
    <>
      <PageHeader
        title="Grants &amp; Fund Management"
        subtitle="Grant lifecycle, releases, utilisation and audit — one view."
      />
      {anyError && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🎁" iconBg="#dcfce7" label="Active Grants" value={activeGrants} />
        <StatCard icon="💰" iconBg="#f1f5f9" label="Sanctioned (FY)" value={formatMoney(sanctionedTotal)} />
        <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={formatMoney(data.disbursedAmount)} />
        <StatCard icon="📋" iconBg="#fef3c7" label="UC Pending" value={data.pendingUCs} />
      </StatGrid>
      <Card title="Grants">
        {grants.length === 0 ? (
          <EmptyState
            icon="🎁"
            title="No grants yet"
            message="Sanctioned grants will appear here once they are recorded."
          />
        ) : (
          <DataTable<GrantSummary>
            columns={columns}
            rows={grants}
            rowLinkKey="id"
            rowLinkPrefix="/grants/"
            sortable
            filterable
            filterPlaceholder="Filter grants…"
            pageSize={10}
          />
        )}
      </Card>
    </>
  );
}
