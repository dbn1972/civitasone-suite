import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBranding } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getThemeBranding();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/themes">Themes</a>
      </nav>
      <ModuleListPage
        title="Themes — Branding"
        description="Branding packs from theme-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
