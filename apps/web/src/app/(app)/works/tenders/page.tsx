import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { TendersTable } from "./TendersTable";

type ApiTender = Record<string, unknown>;

async function getTenders() {
  return fetchJson<unknown, ApiTender[]>("/api/v1/works/tenders", [], {
    telemetryKey: "works.tenders",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiTender[] })?.data;
      return Array.isArray(arr) ? (arr as ApiTender[]) : null;
    },
  });
}

export default async function TendersPage() {
  const { data: tenders, source } = await getTenders();

  const total = tenders.length;
  const preTender = tenders.filter((t) => String(t.status ?? "").toLowerCase() === "pre_tender").length;
  const published = tenders.filter((t) => String(t.status ?? "").toLowerCase() === "published").length;
  const awarded = tenders.filter((t) => String(t.status ?? "").toLowerCase() === "awarded").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Tender Pipeline"
        subtitle="Pre-tender, quotation, and award management."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📢" iconBg="#eff6ff" label="Total Tenders" value={total} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Pre-Tender" value={preTender} />
        <StatCard icon="📤" iconBg="#ecfdf3" label="Published" value={published} />
        <StatCard icon="🏆" iconBg="#f0fdf4" label="Awarded" value={awarded} />
      </StatGrid>
      <Card title="Tenders">
        <TendersTable tenders={tenders} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
