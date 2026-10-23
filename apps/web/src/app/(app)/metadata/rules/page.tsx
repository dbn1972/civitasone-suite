import { getRulesForEntity } from "../_data";
import { EntityScopedListPage } from "../_components/EntityScopedListPage";

export const dynamic = "force-dynamic";

type SP = { entity?: string };

export default async function MetadataRulesPage(props: { searchParams?: Promise<SP> }) {
  const searchParams = await props.searchParams;
  // GAP-METADATA-RULES-02/-03: was calling getMetadataEntities() and labelling
  // entity rows "Rules"; rules are only listed entity-scoped
  // (GET /v1/metadata/entities/:entityId/validation-rules).
  return EntityScopedListPage({
    title: "Validation rules",
    resourceLabel: "validation rules",
    resourceSingular: "validation rule",
    detailHeader: "Error message",
    ...(searchParams?.entity ? { selectedEntityId: searchParams.entity } : {}),
    loadRows: getRulesForEntity,
  });
}
