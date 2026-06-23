import type { ReactNode } from "react";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusPill } from "@/app/_components/ds";
import { getGrantsDashboard, getGrants } from "../../../_data/loaders";
import type { GrantSummary } from "@civitasone/types";

type Col = {
  key: keyof GrantSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantSummary) => ReactNode;
};

const columns: Col[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "title", label: "Title" },
  { key: "granteeName", label: "Grantee", render: (row) => row.granteeName ?? "—" },
  {
    key: "totalAmount",
    label: "Total Amount",
    align: "right",
    render: (row) => `₹${(row.totalAmount / 100).toLocaleString("en-IN")}`,
  },
  {
    key: "disbursedAmount",
    label: "Disbursed",
    align: "right",
    render: (row) => `₹${(row.disbursedAmount / 100).toLocaleString("en-IN")}`,
  },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  },
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
        <StatCard icon="💰" iconBg="#f1f5f9" label="Sanctioned (FY)" value={`₹${(sanctionedTotal / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={`₹${(data.disbursedAmount / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="📋" iconBg="#fef3c7" label="UC Pending" value={data.pendingUCs} />
      </StatGrid>
      <Card title="Grants">
        <DataTable<GrantSummary>
          columns={columns}
          rows={grants}
          rowHref={(r) => `/grants/${r.id}`}
        />
      </Card>
    </>
  );
}
