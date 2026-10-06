"use client";

import Link from "next/link";
import { StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

/**
 * GAP-WORKS-PROPOSALS-02/03/04: the proposals list's stat cards, tab counts
 * and card title used to be computed server-side from the raw fetch, while the
 * table rendered useSeededResource's (possibly cached) copy — so offline the
 * stats read 0 / "(0)" next to a table full of saved rows. And server-side
 * ?status= filtering combined with a client component that never re-seeded on
 * a tab switch meant the table could show the previous tab's rows under the
 * new title, and the single "works-proposals" cache key was overwritten with
 * whichever filtered subset loaded last, corrupting the offline copy.
 *
 * This client view fixes all three: it owns the ONE useSeededResource call for
 * the FULL unfiltered list (cached under one stable key), computes every count
 * from that same `data`, and filters client-side by the active tab — so stats,
 * title and rows can never disagree, a tab switch is instant and correct, and
 * the offline cache always holds the complete list.
 */

const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "estimatedCost", label: "Estimated Cost", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
  { key: "office", label: "Office", sortable: true },
];

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "dao_finalized", label: "DAO Finalized" },
] as const;

function tabHref(key: string) {
  return key === "all" ? "/works/proposals" : `/works/proposals?status=${key}`;
}

type Row = Record<string, unknown>;

export function ProposalsView({
  proposals,
  source,
  requestedStatus,
}: {
  proposals: Row[];
  source: "api" | "error";
  requestedStatus?: string;
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource(
    "works-proposals",
    proposals,
    source,
    (rows) => rows.length === 0,
  );

  // GAP-WORKS-PROPOSALS-04: an unknown ?status= (e.g. "foo") must normalise to
  // "all" and show the full list under the "All" title, not an empty "All (0)".
  const known = STATUS_TABS.some((t) => t.key === requestedStatus);
  const activeTab = known ? (requestedStatus as string) : "all";

  const total = data.length;
  const countByStatus = data.reduce<Record<string, number>>((acc, p) => {
    const s = String(p.status);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = activeTab === "all" ? data : data.filter((p) => String(p.status) === activeTab);
  const activeTabLabel = STATUS_TABS.find((t) => t.key === activeTab)?.label ?? "All";
  const title = activeTab === "all" ? `All Proposals (${total})` : `${activeTabLabel} (${filtered.length})`;

  // GAP-WORKS-PROPOSALS-02: an actual load failure with no cached copy is shown
  // honestly, not as a wall of zeros.
  if (provenance === "error-no-data") {
    return (
      <RefreshErrorState error={toHumanError("load", { area: "work proposals" })} source={{ area: "work proposals" }} />
    );
  }

  return (
    <>
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #eff6ff)" label="Total Works"   value={total} />
        <StatCard icon="📝" iconBg="var(--warnbg, #fef3c7)" label="Draft"         value={countByStatus["draft"] ?? 0} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)" label="DAO Finalized" value={countByStatus["dao_finalized"] ?? 0} />
      </StatGrid>

      <nav
        aria-label="Filter proposals by status"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        {STATUS_TABS.map((tab) => {
          const count = tab.key === "all" ? total : (countByStatus[tab.key] ?? 0);
          const isActive = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              aria-current={isActive ? "page" : undefined}
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
      </nav>

      <Card title={title}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        {/* GAP-WORKS-PROPOSALS-05: proposals only ever reach draft/dao_finalized
            here; the post-DAO lifecycle (Technical Sanction, Administrative
            Approval) lives under /works/approvals. Link there so the lifecycle
            after DAO finalisation is discoverable from this register. */}
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
          After DAO finalisation, a proposal moves on to{" "}
          <Link href="/works/approvals" style={{ color: "var(--primary, var(--accent))" }}>
            Technical Sanction &amp; Administrative Approval
          </Link>
          .
        </p>
        <DataTable
          columns={columns}
          rows={filtered}
          sortable
          filterable
          filterPlaceholder="Search proposals..."
          pageSize={15}
          exportable
          exportFilename="work-proposals"
          emptyIcon="📋"
          emptyTitle="No proposals found"
          emptyMessage="Work proposals will appear here once created."
          rowHref={(row) => "/works/proposals/" + String(row.id ?? "")}
        />
      </Card>
    </>
  );
}
