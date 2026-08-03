import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getGatewayCatalogue } from "./_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getGatewayCatalogue();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/admin">Admin</a>
      </nav>
      <ModuleListPage
        title="Gateway — Route catalogue"
        description="API gateway proxy catalogue entries from gateway-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
