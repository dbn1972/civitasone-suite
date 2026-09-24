import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyPrograms } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyPrograms();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Programs"
        description="Loyalty programmes from loyalty-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
