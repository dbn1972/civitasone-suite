import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallSilos } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallSilos();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      {/* GAP-INSTALL-SILOS-05: removed the duplicate local Breadcrumb landmark;
          the global AutoBreadcrumb supplies Home / Install / Silo Provisions. */}
      <ModuleListPage
        title="Silo provisions"
        description="Silo provision records."
        rows={data}
        source={source}
        back="/install/console"
        backLabel="Install console"
        errorArea="silo provisions"
      />
    </div>
  );
}
