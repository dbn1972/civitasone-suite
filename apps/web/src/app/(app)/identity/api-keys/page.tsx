import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getIdentityApiKeys } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentityApiKeys();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/identity">Identity</a>
      </nav>
      <ModuleListPage
        title="Identity — API keys"
        description="API keys from identity-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
