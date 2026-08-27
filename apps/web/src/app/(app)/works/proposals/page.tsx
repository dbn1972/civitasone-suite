import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getProposals } from "../_data/loaders";
import { ProposalsTable } from "./ProposalsTable";

// Bug fix (works-deep-verify, MEDIUM/L3): this list used to include
// "Submitted" and "TS Eligible" filter tabs. work_proposals.status is only
// ever set to "draft" (on create) or "dao_finalized" (on DAO finalize) —
// see services/works-service/src/modules/proposal/consumer.ts, the only
// writer of this column. "submitted" is proposals/[id]'s local pre-finalize
// UI toast wording, never persisted; "ts_eligible" is referenced only in
// proposal/schema.ts's column comment and approval/domain.ts's gate check,
// with no code path that ever sets it. Both tabs were therefore permanently
// dead: reachable, but guaranteed-empty regardless of real data — a clerk
// clicking either would see "no proposals" and reasonably read that as a
// system problem. Removed rather than guessing at unimplemented lifecycle
// business logic (see PR description).
const STATUS_TABS = [
  { key: "all",           label: "All" },
  { key: "draft",         label: "Draft" },
  { key: "dao_finalized", label: "DAO Finalized" },
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
