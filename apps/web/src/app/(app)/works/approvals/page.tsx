import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getApprovalsAa, getApprovalsTs } from "../_data/loaders";
import { ApprovalsTable } from "./ApprovalsTable";

export default async function ApprovalsPage() {
  const [{ data: aaApprovals, source: aaSource }, { data: tsApprovals, source: tsSource }] = await Promise.all([
    getApprovalsAa(),
    getApprovalsTs(),
  ]);

  const source = aaSource === "error" || tsSource === "error" ? "error" : "api";
  const totalAA = aaApprovals.length;
  const totalTS = tsApprovals.length;
  const pendingAA = aaApprovals.filter((a) => a.status === "draft").length;
  const pendingTS = tsApprovals.filter((a) => a.status === "draft").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="AA / TS Register"
        subtitle="Administrative Approval and Technical Sanction registers."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {source === "error" && <DataSourceBadge source={source} />}
            <Link href="/works/approvals/new" className="btn" style={{ minHeight: 36, fontSize: 13, padding: "6px 14px", border: "1px solid var(--line)" }}>+ New AA</Link>
            <Link href="/works/approvals/ts-new" className="btn primary" style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}>+ New TS</Link>
          </div>
        }
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
