import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { ClosureTable } from "./ClosureTable";

type ApiClosure = Record<string, unknown>;

async function getClosures() {
  return fetchJson<unknown, ApiClosure[]>("/api/v1/works/closure", [], {
    telemetryKey: "works.closure",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiClosure[] })?.data;
      return Array.isArray(arr) ? (arr as ApiClosure[]) : null;
    },
  });
}

export default async function ClosurePage() {
  const { data: closures, source } = await getClosures();

  const total = closures.length;
  const closed = closures.filter((c) => String(c.status ?? "").toLowerCase() === "closed").length;
  const dropped = closures.filter((c) => String(c.status ?? "").toLowerCase() === "dropped").length;
  const completion = closures.filter((c) => String(c.status ?? "").toLowerCase() === "completion").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Closure"
        subtitle="Closed, dropped, and completion list works."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🔒" iconBg="#eff6ff" label="Total" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Closed" value={closed} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Dropped" value={dropped} />
        <StatCard icon="📋" iconBg="#f0fdf4" label="Completion List" value={completion} />
      </StatGrid>
      <Card title="Works Closure">
        <ClosureTable closures={closures} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
