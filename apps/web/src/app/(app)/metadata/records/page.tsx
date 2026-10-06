import { getRecordsForEntity } from "../_data";
import { EntityScopedListPage } from "../_components/EntityScopedListPage";

export const dynamic = "force-dynamic";

type SP = { entity?: string };

export default async function MetadataRecordsPage({ searchParams }: { searchParams?: SP }) {
  // GAP-METADATA-RECORDS-02/-03: was calling getMetadataEntities() and
  // labelling entity rows "Records"; records are only listed entity-scoped
  // (GET /v1/metadata/entities/:entityId/records).
  return EntityScopedListPage({
    title: "Records",
    resourceLabel: "records",
    resourceSingular: "record",
    ...(searchParams?.entity ? { selectedEntityId: searchParams.entity } : {}),
    loadRows: getRecordsForEntity,
  });
}
