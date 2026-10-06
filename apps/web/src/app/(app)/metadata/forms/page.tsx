import { getFormsForEntity } from "../_data";
import { EntityScopedListPage } from "../_components/EntityScopedListPage";

export const dynamic = "force-dynamic";

type SP = { entity?: string };

export default async function MetadataFormsPage({ searchParams }: { searchParams?: SP }) {
  // GAP-METADATA-FORMS-02/-03: was calling getMetadataEntities() and labelling
  // entity rows "Forms". A "form" is a layout_definition (CAP-109), listed only
  // entity-scoped (GET /v1/metadata/entities/:entityId/layouts) — there is no
  // top-level /v1/metadata/forms list — so forms also drill from an entity.
  return EntityScopedListPage({
    title: "Forms",
    resourceLabel: "forms",
    resourceSingular: "form",
    detailHeader: "Layout type",
    ...(searchParams?.entity ? { selectedEntityId: searchParams.entity } : {}),
    loadRows: getFormsForEntity,
  });
}
