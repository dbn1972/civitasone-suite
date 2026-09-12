import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function MetadataEntitiesPage() {
  const result = await getMetadataEntities();
  const { data } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  return (
    <main className="page-main wrap" aria-label="Metadata entities">
      <PageHeader
        title="Entities"
        subtitle="Custom entity definitions from /api/v1/metadata/entities."
        back="/metadata"
      />
      <Card title="Entity definitions">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "entity definitions" })} backHref="/metadata" />
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon="📦" title="No entities" message="Create entities via the metadata API." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
