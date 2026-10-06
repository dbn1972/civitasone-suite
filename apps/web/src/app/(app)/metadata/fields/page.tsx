import { getFieldsForEntity } from "../_data";
import { EntityScopedListPage } from "../_components/EntityScopedListPage";

export const dynamic = "force-dynamic";

type SP = { entity?: string };

export default async function MetadataFieldsPage({ searchParams }: { searchParams?: SP }) {
  // GAP-METADATA-FIELDS-02/-03: this page used to call getMetadataEntities()
  // and label entity rows as "Fields"; the metadata-service only lists fields
  // entity-scoped (GET /v1/metadata/entities/:entityId/fields), so the real
  // contract is the entity drill-down the subtitle always promised.
  return EntityScopedListPage({
      title: "Fields",
      resourceLabel: "fields",
      resourceSingular: "field",
      detailHeader: "Type",
      ...(searchParams?.entity ? { selectedEntityId: searchParams.entity } : {}),
      loadRows: getFieldsForEntity,
    });
}
