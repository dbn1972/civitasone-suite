import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeTemplates } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getThemeTemplates();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/themes">Themes</a>
      </nav>
      <ModuleListPage
        title="Themes — Templates"
        description="Theme templates from theme-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
