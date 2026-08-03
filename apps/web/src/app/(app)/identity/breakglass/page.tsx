import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getIdentityBreakglass } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentityBreakglass();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/identity">Identity</a>
      </nav>
      <ModuleListPage
        title="Identity — Break-glass"
        description="Break-glass access requests."
        rows={data}
        source={source}
      />
    </main>
  );
}
