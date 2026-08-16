import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmRti } from "../../../_data/loaders";
import { RtiTable } from "./RtiTable";

type SP = {
  status?: string;
  section?: string;
  search?: string;
};

export default async function RtiPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const { data, source } = await getCrmRti({
    ...(searchParams?.status   ? { status: searchParams.status }   : {}),
    ...(searchParams?.section  ? { section: searchParams.section } : {}),
    ...(searchParams?.search   ? { search: searchParams.search }   : {}),
  });

  const rows = data.rows;

  // SLA helper — days until due_at
  function daysLeft(dueAt: string | null): number {
    if (!dueAt) return Infinity;
    return Math.ceil(
      (new Date(dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
  }

  const overdue = rows.filter((r) => daysLeft(r.dueAt) < 0).length;
  const critical = rows.filter(
    (r) => daysLeft(r.dueAt) >= 0 && daysLeft(r.dueAt) < 7,
  ).length;
  const open = rows.filter(
    (r) => !["RESPONDED", "DISPOSED"].includes(r.status),
  ).length;
  const stat = (n: number) =>
    source === "error" ? "—" : n.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        title="RTI Requests"
        subtitle="Right to Information Act 2005 — 30-day statutory response register."
        back="/crm"
        actions={
          <Link href="/crm/rti/new" className="btn primary">
            + New RTI Request
          </Link>
        }
      />

      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard
          icon="📋"
          iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)"
          label="Open (this page)"
          value={stat(open)}
        />
        <StatCard
          icon="🔴"
          iconBg="color-mix(in srgb, var(--bad) 12%, transparent)"
          label="Overdue (this page)"
          value={stat(overdue)}
        />
        <StatCard
          icon="⚠️"
          iconBg="color-mix(in srgb, var(--warn) 15%, transparent)"
          label="Critical — &lt;7 days (this page)"
          value={stat(critical)}
        />
        <StatCard
          icon="📁"
          iconBg="color-mix(in srgb, var(--good) 12%, transparent)"
          label="Total RTI Requests"
          value={stat(data.total)}
        />
      </StatGrid>

      <RtiTable rows={rows} source={source === "error" ? "error" : "api"} />
    </>
  );
}
