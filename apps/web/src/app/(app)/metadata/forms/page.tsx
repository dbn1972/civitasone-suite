import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getMetadataEntities } from "../_data";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function MetadataFormsPage() {
  const result = await getMetadataEntities();
  const { data } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  return (
    <main className="page-main wrap" aria-label="Metadata forms">
      <PageHeader
        title="Forms"
        subtitle="Wired to /api/v1/metadata/entities (select entity to drill into forms)."
        back="/metadata"
      />
      <Card title="Forms">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "forms" })} backHref="/metadata" />
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon="📦" title="No data" message="Entities from the metadata API appear here as the entry point for forms." />
        ) : (
          <pre className="text-xs overflow-auto p-3">{JSON.stringify(data.slice(0, 50), null, 2)}</pre>
        )}
      </Card>
    </main>
  );
}
