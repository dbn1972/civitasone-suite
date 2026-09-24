import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyRedemptions } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyRedemptions();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Redemptions"
        description="Point redemption history."
        rows={data}
        source={source}
      />
    </div>
  );
}
