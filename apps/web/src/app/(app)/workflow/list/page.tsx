import { Suspense } from "react";
import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState, SkeletonTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { InstancesTable } from "../_components/InstancesTable";
import { getInstances, getAnalyticsSummary, inProgressCount } from "../_data/workflowData";

const LIST_LIMIT = 200;

export default async function WorkflowInstancesPage({
  searchParams,
}: {
  searchParams?: { definitionId?: string };
}) {
  // GAP2-WORKFLOW-DEFINITIONS-DETAIL-01 — honor the per-definition filter the
  // definition detail page's "View instances" link sends. Previously this page
  // ignored ?definitionId entirely and rendered every tenant instance, so the
  // control presented as a filter but silently showed an unfiltered list.
  const definitionId = searchParams?.definitionId;
  const [{ data: instances, source }, { data: analytics, source: analyticsSource }] = await Promise.all([
    getInstances(definitionId ? { definitionId } : {}),
    getAnalyticsSummary(),
  ]);

  // When a definition filter is active the stat tiles describe the WHOLE tenant
  // (analytics is not per-definition), so they would contradict the filtered
  // table. Suppress them in that case to avoid a misleading mix.
  const filtered = Boolean(definitionId);
  // The active filter's human label, taken from the first matching row.
  const filterLabel = filtered
    ? instances.find((i) => i.definitionName)?.definitionName ??
      instances.find((i) => i.definitionCode)?.definitionCode ??
      "this definition"
    : null;

  // GAP-WORKFLOW-LIST-01 — do NOT discard the analytics source. When analytics
  // failed, the EMPTY_ANALYTICS fallback would render active/completed/
  // cancelled as a fabricated 0 above a full table, and Total would silently
  // fall back to the (capped) row count. Pass null so StatCard shows "—"
  // instead of a lie.
  const analyticsOk = analyticsSource !== "error";
  // GAP-WORKFLOW-HOME-03 — "In progress" counts active + pending + running,
  // matching the hub (page.tsx) so the same cohort isn't two different numbers
  // one click apart. Still null (→ "—") when analytics errored (LIST-01).
  const active = analyticsOk ? inProgressCount(analytics.instancesByStatus) : null;
  const completed = analyticsOk ? analytics.instancesByStatus["completed"] ?? 0 : null;
  const cancelled = analyticsOk
    ? (analytics.instancesByStatus["cancelled"] ?? 0) + (analytics.instancesByStatus["canceled"] ?? 0)
    : null;
  // Total uses the authoritative analytics count; no rows.length fallback (which
  // is capped at LIST_LIMIT and would disagree with Completed for large tenants).
  const total = analyticsOk ? analytics.totalInstances : null;

  // GAP-WORKFLOW-LIST-01 — honest "first N of M" notice when the row window is
  // capped and the true total is known to be larger.
  const capped = instances.length >= LIST_LIMIT;

  return (
    <>
      <PageHeader
        title="Workflow — Instances"
        subtitle="Running and completed process instances, loaded live from the workflow service."
        back="/workflow"
        actions={source === "error" || !analyticsOk ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🧩" iconBg="#eef2ff" label="Total" value={filtered ? instances.length : total} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="In progress" value={filtered ? null : active} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Completed" value={filtered ? null : completed} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Cancelled" value={filtered ? null : cancelled} />
      </StatGrid>

      {filtered ? (
        <div className="pad" style={{ paddingBottom: 0 }}>
          <span
            className="chip"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}
          >
            Filtered to {filterLabel}
            <a href="/workflow/list" style={{ textDecoration: "underline" }}>
              Clear filter
            </a>
          </span>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <Card title="Instances">
          {source === "error" ? (
            // GAP-WORKFLOW-LIST-02 — a real retry (RefreshErrorState → router.refresh),
            // not a dead-end warning EmptyState.
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "instances" })} source={{ area: "instances", status: 500 }} />
            </div>
          ) : instances.length === 0 ? (
            <div className="pad">
              <EmptyState icon="🧩" title="No instances yet" message="Process instances will appear here once workflows are started." />
            </div>
          ) : (
            <div className="pad">
              {capped ? (
                <p className="mut" style={{ margin: "0 0 10px", fontSize: 13 }}>
                  Showing the first {LIST_LIMIT}
                  {total != null && total > LIST_LIMIT ? ` of ${total}` : ""} instances. Use filters to narrow the list.
                </p>
              ) : null}
              <Suspense fallback={<SkeletonTable rows={6} />}>
                <InstancesTable instances={instances} />
              </Suspense>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
