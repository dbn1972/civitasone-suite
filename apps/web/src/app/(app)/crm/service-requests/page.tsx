import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmServiceRequests } from "../../../_data/loaders";
import { ServiceRequestsTable } from "./ServiceRequestsTable";

type SP = { status?: string; priority?: string; serviceType?: string; search?: string };

export default async function ServiceRequestsPage({ searchParams }: { searchParams?: SP }) {
  const { data, source } = await getCrmServiceRequests({
    ...(searchParams?.status ? { status: searchParams.status } : {}),
    ...(searchParams?.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams?.serviceType ? { serviceType: searchParams.serviceType } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
  });

  const rows = data.rows;

  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const closed = rows.filter((r) => r.status === "closed" || r.status === "resolved").length;
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title="Service Requests"
        subtitle="Citizen service requests — track from intake to closure."
        back="/crm"
        actions={
          // Was pointing at /crm/grievances/new: a service request is a separate
          // register with its own reference series and service-type taxonomy, so
          // the grievance form could not create one.
          <Link href="/crm/service-requests/new" className="btn primary">
            + New Request
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard icon="📥" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Open / In Progress (this page)" value={stat(open)} />
        <StatCard icon="⏳" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label="Pending (this page)" value={stat(pending)} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label="Closed / Resolved (this page)" value={stat(closed)} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Total Requests" value={stat(data.total)} />
      </StatGrid>

      <ServiceRequestsTable requests={rows} source={source === "error" ? "error" : "api"} />
    </>
  );
}
