import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getIdentityWebauthn } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentityWebauthn();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/identity">Identity</a>
      </nav>
      <ModuleListPage
        title="Identity — WebAuthn"
        description="WebAuthn credentials."
        rows={data}
        source={source}
      />
    </main>
  );
}
