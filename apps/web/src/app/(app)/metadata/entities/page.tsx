import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";

export const dynamic = "force-dynamic";

export default async function MetadataEntitiesPage() {
  const { data, source } = await getMetadataEntities();
  return (
    <main className="page-main wrap" aria-label="Metadata entities">
      <PageHeader
        title="Entities"
        subtitle="Custom entity definitions from /api/v1/metadata/entities."
        back="/metadata"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Entity definitions">
        {data.length === 0 ? (
          <EmptyState icon="📦" title="No entities" message="Create entities via the metadata API." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
