import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmGrievances } from "../../../_data/loaders";
import { GrievancesTable } from "./GrievancesTable";

type SP = { status?: string; priority?: string; search?: string };

export default async function GrievancesPage({ searchParams }: { searchParams?: SP }) {
  // The status/priority/search params used to be declared and then dropped on the
  // floor — the loader was called with no arguments, so a filtered URL returned
  // the unfiltered register. Filtering happens server-side because the API
  // paginates: narrowing client-side would only narrow the current page.
  const { data, source } = await getCrmGrievances({
    ...(searchParams?.status ? { status: searchParams.status } : {}),
    ...(searchParams?.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
  });

  const rows = data.rows;

  // Counts are derived from the page the API returned, so they describe the
  // current view, not the register. `total` is the only figure that comes from
  // the server and is safe to present as a whole-register number.
  // CPGRAMS status vocabulary (services/crm-service grievances-domain.ts STATUS):
  // REGISTERED / FORWARDED / ATTENDED / DISPOSED / APPEAL. These filters used
  // to compare against a legacy open/escalated/resolved/closed vocabulary
  // that the backend has not returned since the CPGRAMS migration, so every
  // bucket here silently showed 0 regardless of the real register.
  const open = rows.filter((r) => r.status === "REGISTERED" || r.status === "FORWARDED" || r.status === "ATTENDED").length;
  const escalated = rows.filter((r) => r.status === "APPEAL").length;
  const resolved = rows.filter((r) => r.status === "DISPOSED").length;
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title="Grievances"
        subtitle="Citizen complaints and grievance register — log, assign, escalate, and resolve."
        back="/crm"
        actions={
          <Link href="/crm/grievances/new" className="btn primary">
            + New Grievance
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard icon="🔴" iconBg="color-mix(in srgb, var(--bad) 12%, transparent)" label="Open (this page)" value={stat(open)} />
        <StatCard icon="⚠️" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label="Escalated (this page)" value={stat(escalated)} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label="Resolved / Closed (this page)" value={stat(resolved)} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Total Grievances" value={stat(data.total)} />
      </StatGrid>

      <GrievancesTable grievances={rows} source={source === "error" ? "error" : "api"} />
    </>
  );
}
