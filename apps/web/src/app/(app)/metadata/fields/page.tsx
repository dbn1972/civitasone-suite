import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";

export const dynamic = "force-dynamic";

export default async function MetadataFieldsPage() {
  const { data, source } = await getMetadataEntities();
  return (
    <main className="page-main wrap" aria-label="Metadata fields">
      <PageHeader
        title="Fields"
        subtitle="Wired to /api/v1/metadata/entities (select entity to drill into fields)."
        back="/metadata"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Fields">
        {data.length === 0 ? (
          <EmptyState icon="📦" title="No data" message="Entities from the metadata API appear here as the entry point for fields." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
