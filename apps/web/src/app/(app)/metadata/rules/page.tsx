import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { fetchJson } from "@/app/_lib/api";

export const dynamic = "force-dynamic";

export default async function MetadataRulesPage() {
  let data: unknown[] = [];
  let source: "live" | "error" = "live";
  try {
    const res = await fetchJson<{ data?: unknown[] }>("/api/v1/metadata/entities");
    data = res.data ?? [];
  } catch {
    source = "error";
  }
  return (
    <main className="page-main wrap" aria-label="Metadata rules">
      <PageHeader title="Rules" subtitle="Wired to /api/v1/metadata/entities (select entity to drill into rules)." back="/metadata" />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Rules">
        {data.length === 0 ? (
          <EmptyState icon="📦" title="No data" message="Entities from the metadata API appear here as the entry point for rules." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
