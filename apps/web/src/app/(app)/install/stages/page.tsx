import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallStages } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallStages();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/install/console">Install console</a>
      </nav>
      <ModuleListPage
        title="Install — Stages"
        description="Installer stages from install-service. Stage 3 activates a Domain Pack (municipal-in-v1 → TL / PGR / Water drafts)."
        rows={data}
        source={source}
      />
      <p className="back" style={{ marginTop: 16 }}>
        <a href="/install/domain-packs">Open Domain Pack activation (Stage 3) →</a>
      </p>
    </div>
  );
}
