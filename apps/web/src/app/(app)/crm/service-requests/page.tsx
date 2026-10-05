import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmServiceRequests } from "../../../_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ServiceRequestsFilterBar } from "./ServiceRequestsFilterBar";
import { ServiceRequestsTable } from "./ServiceRequestsTable";

type SP = {
  status?: string;
  priority?: string;
  serviceType?: string;
  search?: string;
  page?: string;
};

const PAGE_SIZE = 15;

// Only a privileged role may export citizen personal data (GAP-CRM-SERVICE-REQUESTS-02).
const EXPORT_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

// Service types offered by the New Request form — reused to drive the filter.
const SERVICE_TYPES = [
  "New Water Connection",
  "New Electricity Connection",
  "Birth Certificate",
  "Death Certificate",
  "Property Mutation",
  "Trade Licence",
  "Building Permission",
  "Waste Collection",
  "Street Light Installation",
  "Other",
];

export default async function ServiceRequestsPage({ searchParams }: { searchParams?: SP }) {
  const t = await getTranslations("crmServiceRequestsPage");
  const pageParam = Number.parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const { data, source } = await getCrmServiceRequests({
    ...(searchParams?.status ? { status: searchParams.status } : {}),
    ...(searchParams?.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams?.serviceType ? { serviceType: searchParams.serviceType } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
    limit: PAGE_SIZE,
    page,
  });

  const rows = data.rows;
  const total = data.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const roles = getSessionRoles();
  const canExport = EXPORT_ROLES.some((role) => roles.includes(role));

  // GAP-CRM-SERVICE-REQUESTS-05: summary tiles use SERVER-SIDE per-status counts
  // for the whole filtered register, so the parts sum to Total regardless of the
  // 15-row page. Cancelled is counted in its own tile so no status is dropped.
  const sc = data.statusCounts ?? {};
  const open = (sc.open ?? 0) + (sc.in_progress ?? 0);
  const pending = sc.pending ?? 0;
  const closed = (sc.closed ?? 0) + (sc.resolved ?? 0);
  const cancelled = sc.cancelled ?? 0;
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  // Vary the offline cache key by the full query (filters + page) so one page's
  // rows are never served for another's (GAP-CRM-SERVICE-REQUESTS-01).
  const queryKey = new URLSearchParams({
    ...(searchParams?.status ? { status: searchParams.status } : {}),
    ...(searchParams?.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams?.serviceType ? { serviceType: searchParams.serviceType } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
    page: String(page),
  }).toString();

  return (
    <>
      <PageHeader
        title="Service Requests"
        subtitle="Citizen service requests — track from intake to closure."
        back="/crm"
        actions={
          <Link href="/crm/service-requests/new" className="btn primary">
            + New Request
          </Link>
        }
      />

      <StatGrid>
        <StatCard icon="📥" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label={t("openInProgress")} value={stat(open)} />
        <StatCard icon="⏳" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label={t("pending")} value={stat(pending)} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label={t("closedResolved")} value={stat(closed)} />
        <StatCard icon="🚫" iconBg="color-mix(in srgb, var(--bad) 10%, transparent)" label={t("cancelled")} value={stat(cancelled)} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Total Requests" value={stat(total)} />
      </StatGrid>

      <ServiceRequestsFilterBar
        status={searchParams?.status}
        priority={searchParams?.priority}
        serviceType={searchParams?.serviceType}
        search={searchParams?.search}
        serviceTypes={SERVICE_TYPES}
      />

      <ServiceRequestsTable
        requests={rows}
        source={source === "error" ? "error" : "api"}
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={PAGE_SIZE}
        canExport={canExport}
        queryKey={queryKey}
      />
    </>
  );
}
