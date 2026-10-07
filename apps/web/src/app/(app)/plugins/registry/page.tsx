import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getPluginRegistryCatalog } from "../_data";
import { PluginCatalogTable } from "../PluginCatalogTable";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginRegistryCatalog();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Plugins — Registry"
        subtitle="Catalogue of registered plugin definitions and versions."
        back="/plugins"
        backLabel="Plugins"
      />
      <div className="card" style={{ marginTop: 18 }}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "plugin registry" })} />
        ) : (
          <PluginCatalogTable
            rows={data}
            emptyMessage="No plugin definitions are registered for your organisation yet."
          />
        )}
      </div>
    </div>
  );
}
