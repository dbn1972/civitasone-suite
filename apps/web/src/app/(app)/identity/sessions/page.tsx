import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getIdentitySessions } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentitySessions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/identity">Identity</a>
      </nav>
      <ModuleListPage
        title="Identity — Sessions"
        description="Sessions from identity-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
