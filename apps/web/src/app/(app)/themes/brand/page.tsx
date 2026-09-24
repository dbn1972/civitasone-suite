import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBrand } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getThemeBrand();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/themes">Themes</a>
      </nav>
      <ModuleListPage
        title="Themes — Brand"
        description="Active brand configuration and presets."
        rows={data}
        source={source}
      />
    </div>
  );
}
