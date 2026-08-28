/**
 * Service Book page — Sprint 14 / Lifecycle Phase 2
 * Paginated, filterable chronological service record using ServiceBookView.
 */
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ServiceBookView, type ServiceEntry } from "./_components/ServiceBookView";

async function getData(employeeId?: string): Promise<LoaderResult<ServiceEntry[]>> {
  const path = employeeId
    ? `/api/v1/hrms/service-book?employeeId=${encodeURIComponent(employeeId)}`
    : "/api/v1/hrms/service-book";
  return fetchJson<unknown, ServiceEntry[]>(path, [], {
    telemetryKey: "hr.service-book",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ServiceEntry[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ServiceBookPage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  // The employee profile's "Service Book" quick action links here with
  // ?empId= — previously ignored entirely, so it always showed every
  // employee's entries mixed together instead of the one the officer opened.
  const empId = searchParams?.empId;
  const { data: items, source } = await getData(empId);

  const employees  = new Set(items.map((i) => i.employee ?? i.employeeId).filter(Boolean)).size;
  const transfers  = items.filter((i) =>
    i.eventType === "transfer" || i.eventType === "posting",
  ).length;
  const promotions = items.filter((i) =>
    i.eventType === "promotion" || i.eventType === "increment",
  ).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={empId ? `Service Book — ${items[0]?.employee ?? "Employee"}` : "Service Book"}
        subtitle={
          empId
            ? "This employee's postings, transfers, promotions, and administrative orders in chronological order."
            : "Official service history register — all postings, transfers, promotions, and administrative orders in chronological order."
        }
        back="/hr"
        actions={empId ? <Link href="/hr/service-book" className="btn ghost">View all employees</Link> : <span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📒" iconBg="#e6f0ff" label="Total Entries"         value={items.length} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Employees"             value={employees} />
        <StatCard icon="🔄" iconBg="#fffbe6" label="Transfers / Postings"  value={transfers} />
        <StatCard icon="📈" iconBg="#e6f7f0" label="Promotions / Increments" value={promotions} />
      </StatGrid>

      <Card title="Service Book Entries">
        <div style={{ padding: 16 }}>
          <ServiceBookView entries={items} />
        </div>
      </Card>
    </main>
  );
}
