import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getProposals } from "../_data/loaders";
import { ProposalsTable } from "./ProposalsTable";

const STATUS_TABS = [
  { key: "all",           label: "All" },
  { key: "draft",         label: "Draft" },
  { key: "submitted",     label: "Submitted" },
  { key: "dao_finalized", label: "DAO Finalized" },
  { key: "ts_eligible",  label: "TS Eligible" },
];

function tabHref(key: string) {
  return key === "all" ? "/works/proposals" : `/works/proposals?status=${key}`;
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const { data: proposals, source } = await getProposals();
  const activeTab = searchParams?.status ?? "all";

  const total        = proposals.length;
  const draftCount   = proposals.filter((p) => p.status === "draft").length;
  const daoFinalized = proposals.filter((p) => p.status === "dao_finalized").length;
  const tsEligible   = proposals.filter((p) => p.status === "ts_eligible").length;

  const countByStatus = proposals.reduce<Record<string, number>>((acc, p) => {
    const s = String(p.status);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const filtered =
    activeTab === "all"
      ? proposals
      : proposals.filter((p) => p.status === activeTab);

  const activeTabLabel =
    STATUS_TABS.find((t) => t.key === activeTab)?.label ?? "All";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work Proposals"
        subtitle="Work registration, categorization, and proposal lifecycle."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {source === "error" && <DataSourceBadge source={source} />}
            <Link
              href="/works/proposals/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + New proposal
            </Link>
          </div>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #eff6ff)"  label="Total Works"   value={total} />
        <StatCard icon="📝" iconBg="var(--warnbg, #fef3c7)"  label="Draft"         value={draftCount} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)"  label="DAO Finalized" value={daoFinalized} />
        <StatCard icon="📑" iconBg="#f0fdf4"                 label="TS Eligible"   value={tsEligible} />
      </StatGrid>

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {STATUS_TABS.map((tab) => {
          const count =
            tab.key === "all" ? total : (countByStatus[tab.key] ?? 0);
          const isActive = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              style={{
                fontSize: 13,
                padding: "5px 12px",
                borderRadius: 20,
                background: isActive ? "var(--primary, var(--accent))" : "var(--surface, #fff)",
                color: isActive ? "#fff" : "var(--ink)",
                textDecoration: "none",
                fontWeight: isActive ? 600 : 400,
                border: "1px solid var(--line)",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
              {count > 0 ? ` (${count})` : ""}
            </Link>
          );
        })}
      </div>

      <Card
        title={
          activeTab === "all"
            ? `All Proposals (${total})`
            : `${activeTabLabel} (${filtered.length})`
        }
      >
        <ProposalsTable
          proposals={filtered}
          source={source === "error" ? "error" : "api"}
        />
      </Card>
    </main>
  );
}
