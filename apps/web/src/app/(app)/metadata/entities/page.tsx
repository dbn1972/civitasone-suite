import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";
import { MetadataRowsTable } from "../_components/MetadataRowsTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function MetadataEntitiesPage() {
  const result = await getMetadataEntities();
  const resource = toResourceState(result);

  return (
    <div className="page-main wrap" aria-label="Metadata entities">
      <PageHeader
        title="Entities"
        subtitle="Custom entity definitions for your organisation."
        back="/metadata"
      />
      <Card title="Entity definitions">
        {resource.status === "error" ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "entity definitions" })} backHref="/metadata" />
          </div>
        ) : resource.status === "empty" ? (
          // GAP-METADATA-ENTITIES-02: no API path in user-facing copy; this is
          // a read-only viewer (see batch decision), so the empty state does
          // not promise a create control that does not exist here.
          <div className="pad">
            <EmptyState
              icon="📦"
              title="No entities defined"
              message="Custom entities configured for your organisation will appear here."
            />
          </div>
        ) : (
          <div className="pad">
            <MetadataRowsTable rows={resource.data} resourceLabel="entities" resourceSingular="entity" />
          </div>
        )}
      </Card>
    </div>
  );
}
