import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallModules } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallModules();
  return (
    <div className="page-main">
      {/* GAP-INSTALL-MODULES-05: the global AutoBreadcrumb (AppShell TopBar)
          already provides the Home / Install / Modules trail, so the local
          <nav aria-label="Breadcrumb"> was a second landmark with the same
          name. Removed; the back action is the PageHeader's own next/link. */}
      <ModuleListPage
        title="Modules"
        description="Module resolution catalogue."
        rows={data}
        source={source}
        back="/install/console"
        backLabel="Install console"
        errorArea="install modules"
      />
    </div>
  );
}
