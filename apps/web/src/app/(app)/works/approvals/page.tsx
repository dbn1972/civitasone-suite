import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { ApprovalsTable } from "./ApprovalsTable";

type ApiApproval = Record<string, unknown>;

async function getApprovals(type: "aa" | "ts") {
  return fetchJson<unknown, ApiApproval[]>(`/api/v1/works/approvals/${type}`, [], {
    telemetryKey: `works.approvals.${type}`,
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiApproval[] })?.data;
      return Array.isArray(arr) ? (arr as ApiApproval[]) : null;
    },
  });
}

export default async function ApprovalsPage() {
  const [{ data: aaApprovals, source: aaSource }, { data: tsApprovals, source: tsSource }] = await Promise.all([
    getApprovals("aa"),
    getApprovals("ts"),
  ]);

  const source = aaSource === "error" || tsSource === "error" ? "error" : "api";
  const totalAA = aaApprovals.length;
  const totalTS = tsApprovals.length;
  const pendingAA = aaApprovals.filter((a) => String(a.status ?? "").toLowerCase() === "pending").length;
  const pendingTS = tsApprovals.filter((a) => String(a.status ?? "").toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="AA / TS Register"
        subtitle="Administrative Approval and Technical Sanction registers."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total AA" value={totalAA} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending AA" value={pendingAA} />
        <StatCard icon="📑" iconBg="#ecfdf3" label="Total TS" value={totalTS} />
        <StatCard icon="⏳" iconBg="#fef2f2" label="Pending TS" value={pendingTS} />
      </StatGrid>
      <Card title="Approvals">
        <ApprovalsTable aaApprovals={aaApprovals} tsApprovals={tsApprovals} source={source} />
      </Card>
    </main>
  );
}
