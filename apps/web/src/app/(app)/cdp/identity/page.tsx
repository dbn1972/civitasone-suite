import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpIdentity } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpIdentity();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Identity Graph"
        description="Anonymous visitors pending identity resolution."
        rows={data}
        source={source}
      />
    </main>
  );
}
