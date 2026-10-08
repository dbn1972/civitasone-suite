"use client";

import { DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "billNo", label: "Bill No", sortable: true },
  { key: "work", label: "Work", sortable: true },
  { key: "mode", label: "Mode", sortable: true },
  { key: "gross", label: "Gross", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "netPayable", label: "Net Payable", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "stage", label: "Stage", sortable: true },
  { key: "status", label: "Bucket", cellType: "status" as const, sortable: true },
];

type BillRowLike = Record<string, unknown>;

/**
 * GAP-WORKS-BILLING-03: the register's stat cards and its table must agree.
 * Both now derive from the SAME useSeededResource `data`, so when the live
 * fetch errors/empties and the cache is swapped in, the counts reflect the
 * cached rows actually shown — never 0 next to visible rows.
 *
 * GAP-WORKS-BILLING-01: "Pending" counts only mid-workflow bills; a separate
 * "Draft" card counts drafts (previously drafts were folded into Pending while
 * the row pill still read "Draft", so a draft was counted Pending but labelled
 * Draft). "Submitted to IFMS" keeps its own card.
 */
export function BillingRegister({
  bills,
  source,
  total: trueTotalProp,
}: {
  bills: BillRowLike[];
  source: "api" | "error";
  /** True tenant-wide bill count from the register meta (GAP2-WORKS-APPROVALS-05). */
  total?: number;
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource(
    "works-billing",
    bills,
    source,
    (rows) => rows.length === 0,
  );

  const live = provenance == null || provenance === "live";
  const total = data.length;
  // GAP2-WORKS-APPROVALS-05: "Total Bills" shows the TRUE tenant count from the
  // register meta (not the capped page length). A "first N of M" notice appears
  // when the register is truncated; the bucket counts below are over the shown
  // page only (labelled when truncated).
  const trueTotal = live && typeof trueTotalProp === "number" ? trueTotalProp : total;
  const truncated = total < trueTotal;
  const draft = data.filter((b) => b.status === "draft").length;
  const pending = data.filter((b) => b.status === "pending").length;
  const finalized = data.filter((b) => b.status === "finalized").length;
  const submitted = data.filter((b) => b.status === "submitted_ifms").length;

  return (
    <>
      <StatGrid>
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Bills" value={trueTotal} />
        <StatCard icon="📝" iconBg="#f8fafc" label={truncated ? "Draft (shown)" : "Draft"} value={draft} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={truncated ? "Pending (shown)" : "Pending"} value={pending} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={truncated ? "Finalized (shown)" : "Finalized"} value={finalized} />
        <StatCard icon="📤" iconBg="#f0fdf4" label={truncated ? "Submitted (shown)" : "Submitted to IFMS"} value={submitted} />
      </StatGrid>
      {/* UX-012: the single provenance badge for everything shown below. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {truncated ? (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }} role="note">
          Showing the first {total} of {trueTotal} bills.
        </p>
      ) : null}
      <RegisterTable rows={data} />
    </>
  );
}

/** Presentational table shared by BillingRegister and the standalone export. */
function RegisterTable({ rows }: { rows: BillRowLike[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Search bills..."
      pageSize={15}
      exportable
      exportFilename="works-billing"
      emptyIcon="💰"
      emptyTitle="No bills found"
      emptyMessage="Works billing records will appear here."
      rowHref={(row) => "/works/billing/" + String(row.workId ?? "")}
    />
  );
}

/**
 * Standalone table (badge + rows, no stat cards) — retained for direct use /
 * existing tests. The register page uses <BillingRegister> which also renders
 * the stat cards from the same seeded resource.
 */
export function BillingTable({ bills, source }: { bills: BillRowLike[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource(
    "works-billing",
    bills,
    source,
    (rows) => rows.length === 0,
  );

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <RegisterTable rows={data} />
    </>
  );
}
