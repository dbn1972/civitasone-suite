"use client";

import { useState } from "react";
import { DataTable, StatGrid, StatCard, Tabs, TabPanel } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { PENDING_STATUSES } from "@/lib/auth/workRoles";

const columns = [
  { key: "workNumber", label: "Work (ID)", sortable: true },
  { key: "approvalNumber", label: "Approval Number", sortable: true },
  { key: "date", label: "Date", sortable: true },
  { key: "authority", label: "Authority (ID)", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

type Tab = "aa" | "ts";

const TAB_LABELS = ["AA Register", "TS Register"] as const;

function pendingCount(rows: Record<string, unknown>[]): number {
  return rows.filter((r) => PENDING_STATUSES.has(String(r.status ?? ""))).length;
}

/**
 * When the rows on screen are NOT live (served from cache / unavailable), a
 * numeric 0 would read as a confident "zero records" when we really mean "we
 * don't have an authoritative figure". Show an em dash instead so the count
 * never contradicts/overstates what the badge reports. GAP-WORKS-APPROVALS-03.
 */
function statValue(isLive: boolean, hasRows: boolean, n: number): number | string {
  if (isLive) return n;
  return hasRows ? n : "—";
}

export function ApprovalsTable({
  aaApprovals,
  tsApprovals,
  source,
  aaTotal,
  tsTotal,
}: {
  aaApprovals: Record<string, unknown>[];
  tsApprovals: Record<string, unknown>[];
  source: "api" | "error";
  /** True tenant-wide AA count from the register meta (GAP2-WORKS-APPROVALS-05). */
  aaTotal?: number;
  /** True tenant-wide TS count from the register meta (GAP2-WORKS-APPROVALS-05). */
  tsTotal?: number;
}) {
  const [tab, setTab] = useState<Tab>("aa");
  const {
    data: aaData,
    provenance: aaProvenance,
    offline: aaOffline,
    cachedAt: aaCachedAt,
  } = useSeededResource("works-approvals-aa", aaApprovals, source, (rows) => rows.length === 0);
  const {
    data: tsData,
    provenance: tsProvenance,
    offline: tsOffline,
    cachedAt: tsCachedAt,
  } = useSeededResource("works-approvals-ts", tsApprovals, source, (rows) => rows.length === 0);

  const rows = tab === "aa" ? aaData : tsData;
  // UX-012: each register has its own independent cache entry, so the two
  // useSeededResource calls can genuinely disagree with each other even
  // though the page fed both the same upstream `source`. The badge and the
  // stat counts must reflect the register's actually-rendered rows.
  const provenance = tab === "aa" ? aaProvenance : tsProvenance;
  const offline = tab === "aa" ? aaOffline : tsOffline;
  const cachedAt = tab === "aa" ? aaCachedAt : tsCachedAt;

  // GAP-WORKS-APPROVALS-03: compute the stat cards from the SAME cached data
  // that feeds the table, so a cache fallback can never make the counts
  // disagree with the rows on screen (the page used to compute them from a
  // second, independent read of the raw server arrays).
  const aaLive = aaProvenance == null || aaProvenance === "live";
  const tsLive = tsProvenance == null || tsProvenance === "live";

  // GAP2-WORKS-APPROVALS-05: the "Total" cards show the TRUE tenant count from
  // the register meta (not the capped page length). The register fetches at
  // most 100 rows, so when the true total exceeds the rows actually shown we
  // render a "first N of M" notice and the pending count is explicitly labelled
  // as being computed over the shown page only (it cannot be exact past the
  // cap without fetching every row).
  const aaTrueTotal = aaLive && typeof aaTotal === "number" ? aaTotal : aaData.length;
  const tsTrueTotal = tsLive && typeof tsTotal === "number" ? tsTotal : tsData.length;
  const aaTruncated = aaData.length < aaTrueTotal;
  const tsTruncated = tsData.length < tsTrueTotal;
  const activeTruncated = tab === "aa" ? aaTruncated : tsTruncated;
  const shownCount = tab === "aa" ? aaData.length : tsData.length;
  const trueTotal = tab === "aa" ? aaTrueTotal : tsTrueTotal;

  const rowHref =
    tab === "aa"
      ? (row: Record<string, unknown>) => "/works/approvals/aa/" + String(row.id ?? "")
      : (row: Record<string, unknown>) => "/works/approvals/ts/" + String(row.id ?? "");

  const activeLabel = tab === "aa" ? TAB_LABELS[0] : TAB_LABELS[1];

  return (
    <div>
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total AA" value={statValue(aaLive, aaData.length > 0, aaTrueTotal)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={aaTruncated ? "Pending AA (shown)" : "Pending AA"} value={statValue(aaLive, aaData.length > 0, pendingCount(aaData))} />
        <StatCard icon="📑" iconBg="#ecfdf3" label="Total TS" value={statValue(tsLive, tsData.length > 0, tsTrueTotal)} />
        <StatCard icon="⏳" iconBg="#fef2f2" label={tsTruncated ? "Pending TS (shown)" : "Pending TS"} value={statValue(tsLive, tsData.length > 0, pendingCount(tsData))} />
      </StatGrid>

      {/* GAP-WORKS-APPROVALS-04: replace the hand-rolled role=tab buttons with
          the DS Tabs (roving tabindex + arrow-key nav + aria-controls) and
          wrap the table in the matching TabPanel. */}
      <Tabs
        tabs={[...TAB_LABELS]}
        active={activeLabel}
        onChange={(label) => setTab(label === TAB_LABELS[0] ? "aa" : "ts")}
        ariaLabel="Approval type"
        idPrefix="works-approvals"
      />

      <TabPanel idPrefix="works-approvals" active={activeLabel}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        {activeTruncated ? (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }} role="note">
            Showing the first {shownCount} of {trueTotal} {tab === "aa" ? "AA" : "TS"} records.
          </p>
        ) : null}
        <DataTable
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Search approvals..."
          pageSize={15}
          exportable
          exportFilename={`works-approvals-${tab}`}
          rowHref={rowHref}
          emptyIcon="✅"
          emptyTitle="No approvals found"
          emptyMessage={`${tab === "aa" ? "Administrative Approval" : "Technical Sanction"} records will appear here.`}
        />
      </TabPanel>
    </div>
  );
}
