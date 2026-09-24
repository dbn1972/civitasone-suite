import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBranding } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getThemeBranding();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/themes">Themes</a>
      </nav>
      <ModuleListPage
        title="Themes — Branding"
        description="Branding packs from theme-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
