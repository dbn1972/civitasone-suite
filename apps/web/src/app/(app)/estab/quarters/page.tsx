import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles, hasAnyRole, ESTAB_QUARTER_ACTION_ROLES } from "@/lib/auth/roleGuard";
import { QuartersTable, type QuarterRow } from "./QuartersTable";
import { QuarterCreateForm } from "./QuarterCreateForm";

/** Roles allowed to create quarters — mirrors estab-service ESTAB_ROLES. */
const QUARTER_WRITE_ROLES = ESTAB_QUARTER_ACTION_ROLES;

type QuarterSummary = { total: number; byStatus: Record<string, number> };

async function getQuarters(): Promise<LoaderResult<QuarterRow[]>> {
  return fetchJson<unknown, QuarterRow[]>("/api/v1/estab/quarters", [], {
    telemetryKey: "estab.quarters.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: QuarterRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getQuarterSummary(): Promise<LoaderResult<QuarterSummary | null>> {
  return fetchJson<unknown, QuarterSummary | null>("/api/v1/estab/quarters/summary", null, {
    telemetryKey: "estab.quarters.summary",
    mapResponse: (p) => {
      const obj = (p as { data?: QuarterSummary })?.data ?? (p as QuarterSummary);
      return obj && typeof obj === "object" && "total" in obj ? obj : null;
    },
  });
}

export default async function QuartersPage() {
  const [{ data: quarters, source }, { data: summary, source: summarySource }] =
    await Promise.all([getQuarters(), getQuarterSummary()]);
  const errored = source === "error" || summarySource === "error";

  // GAP-ESTAB-QUARTERS-01: use server-side summary for tiles (correct even when
  // the list is capped), falling back to counting the page rows when no summary.
  const total = summary ? summary.total : quarters.length;
  const vacant = summary ? (summary.byStatus["vacant"] ?? 0) : quarters.filter((q) => q.status === "vacant").length;
  const allotted = summary ? (summary.byStatus["allotted"] ?? 0) : quarters.filter((q) => q.status === "allotted").length;
  const occupied = summary ? (summary.byStatus["occupied"] ?? 0) : quarters.filter((q) => q.status === "occupied").length;
  const other = Math.max(0, total - vacant - allotted - occupied);

  // GAP-ESTAB-QUARTERS-01: truncation notice when list rows < total.
  const truncated = !errored && total > quarters.length;

  // GAP-ESTAB-QUARTERS-03: only estab officers/admins may create quarters.
  const canCreate = hasAnyRole(getSessionRoles(), QUARTER_WRITE_ROLES);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Residential Quarters"
        subtitle="Quarters inventory and the allotment lifecycle — apply, allot, occupy and vacate."
        back="/estab"
        actions={
          <Link href="/estab/quarters/allotments" className="btn ghost" style={{ minHeight: 44 }}>
            Allotment workflow
          </Link>
        }
      />

      <StatGrid>
        <StatCard icon="🏘️" tone="info" label="Total Quarters" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="🟢" tone="good" label="Vacant" value={errored ? "—" : vacant.toLocaleString("en-IN")} />
        <StatCard icon="📋" tone="warn" label="Allotted" value={errored ? "—" : allotted.toLocaleString("en-IN")} />
        <StatCard icon="🏠" tone="neutral" label="Occupied" value={errored ? "—" : occupied.toLocaleString("en-IN")} />
        {!errored && other > 0 ? (
          <StatCard icon="🔧" tone="bad" label="Other" value={other.toLocaleString("en-IN")} hint="Quarters in maintenance, under repair or other statuses not in the named tiles." />
        ) : null}
      </StatGrid>

      {canCreate && <QuarterCreateForm />}

      <Card title="Quarters">
        {errored && quarters.length === 0 ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "quarters" })} />
          </div>
        ) : (
          <>
            {truncated && (
              <p style={{ margin: "0 16px 8px", fontSize: 13, color: "var(--ink2)" }}>
                Showing {quarters.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} quarters.
              </p>
            )}
            <QuartersTable quarters={quarters} />
          </>
        )}
      </Card>
    </div>
  );
}
