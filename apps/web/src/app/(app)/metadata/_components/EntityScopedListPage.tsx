import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getMetadataEntities } from "../_data";
import { EntitySelector } from "./EntitySelector";
import { MetadataRowsTable } from "./MetadataRowsTable";

/**
 * GAP-METADATA-{FIELDS,RULES,RECORDS,FORMS}-01/-02/-03/-04: shared body for the
 * four entity-scoped drill-down pages. Each of those pages previously called
 * getMetadataEntities() and dumped ENTITY rows under its own heading (Fields /
 * Rules / …) as raw JSON, while its subtitle promised a "select entity to drill
 * into …" flow that did not exist and exposed an /api/v1 path.
 *
 * The metadata-service lists these resources only entity-scoped, so this body:
 *   1. loads the entities list (for the picker);
 *   2. with NO entity selected, shows the picker + an honest "choose an entity"
 *      empty state (no API path, names the resource);
 *   3. with an entity selected, loads that entity's rows via the passed scoped
 *      loader and renders them in the shared MetadataRowsTable (no <pre>, no
 *      50-row cap), or a real error state on failure.
 *
 * `loadRows` is injected by each page so this file imports no page-specific
 * loader; it is a Server Component (async, no hooks) and only EntitySelector
 * (the one "use client" island) crosses to the client.
 */
export async function EntityScopedListPage({
  title,
  resourceLabel,
  resourceSingular,
  detailHeader,
  selectedEntityId,
  loadRows,
}: {
  title: string;
  /** Plural domain noun, lower-case, e.g. "fields". */
  resourceLabel: string;
  /** Singular domain noun, lower-case, e.g. "field". */
  resourceSingular: string;
  /** Header for the detail/sublabel column, e.g. "Type". */
  detailHeader?: string;
  selectedEntityId?: string;
  loadRows: (entityId: string) => Promise<LoaderResult<ModuleRowSummary[]>>;
}) {
  const entitiesResult = await getMetadataEntities();
  const entities = entitiesResult.data.map((e) => ({ id: e.id, label: e.label }));

  const rowsResult = selectedEntityId ? await loadRows(selectedEntityId) : null;
  const rowsResource = rowsResult ? toResourceState(rowsResult) : null;

  return (
    <div className="page-main wrap" aria-label={`Metadata ${resourceLabel}`}>
      <PageHeader
        title={title}
        subtitle={`Select an entity to view its ${resourceLabel}.`}
        back="/metadata"
      />

      {entitiesResult.source === "error" ? (
        <Card title={title}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "entities" })} backHref="/metadata" />
          </div>
        </Card>
      ) : (
        <>
          <EntitySelector entities={entities} selected={selectedEntityId} resourceLabel={resourceLabel} />
          <Card title={title}>
            {!rowsResource ? (
              <div className="pad">
                <EmptyState
                  icon="🧭"
                  title={`Choose an entity to see its ${resourceLabel}`}
                  message={
                    entities.length === 0
                      ? "No entities are defined yet, so there is nothing to drill into."
                      : `Pick an entity above and its ${resourceLabel} will appear here.`
                  }
                />
              </div>
            ) : rowsResource.status === "error" ? (
              <div className="pad">
                <RefreshErrorState error={toHumanError("load", { area: resourceLabel })} backHref="/metadata" />
              </div>
            ) : rowsResource.status === "empty" ? (
              <div className="pad">
                <EmptyState
                  icon="📦"
                  title={`No ${resourceLabel} defined`}
                  message={`This entity has no ${resourceLabel} yet.`}
                />
              </div>
            ) : (
              <div className="pad">
                <MetadataRowsTable
                  rows={rowsResource.data}
                  resourceLabel={resourceLabel}
                  resourceSingular={resourceSingular}
                  {...(detailHeader ? { detailHeader } : {})}
                />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
