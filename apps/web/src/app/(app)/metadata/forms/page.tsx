import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";

export const dynamic = "force-dynamic";

export default async function MetadataFormsPage() {
  const { data, source } = await getMetadataEntities();
  return (
    <main className="page-main wrap" aria-label="Metadata forms">
      <PageHeader
        title="Forms"
        subtitle="Wired to /api/v1/metadata/entities (select entity to drill into forms)."
        back="/metadata"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Forms">
        {data.length === 0 ? (
          <EmptyState icon="📦" title="No data" message="Entities from the metadata API appear here as the entry point for forms." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
