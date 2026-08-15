/**
 * Service Book page — Sprint 14 / Lifecycle Phase 2
 * Paginated, filterable chronological service record using ServiceBookView.
 */
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ServiceBookView, type ServiceEntry } from "./_components/ServiceBookView";

async function getData(): Promise<LoaderResult<ServiceEntry[]>> {
  return fetchJson<unknown, ServiceEntry[]>("/api/v1/hrms/service-book", [], {
    telemetryKey: "hr.service-book",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ServiceEntry[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ServiceBookPage() {
  const { data: items, source } = await getData();

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
        title="Service Book"
        subtitle="Official service history register — all postings, transfers, promotions, and administrative orders in chronological order."
        back="/hr"
        actions={<span />}
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
