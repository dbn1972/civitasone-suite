import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBrand } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getThemeBrand();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/themes">Themes</a>
      </nav>
      <ModuleListPage
        title="Themes — Brand"
        description="Active brand configuration and presets."
        rows={data}
        source={source}
      />
    </main>
  );
}
