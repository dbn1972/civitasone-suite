import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPlans } from "../_data";
import { LABELS } from "@/lib/labels";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantPlans();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{LABELS.tenantTitle}</a>
      </nav>
      <ModuleListPage
        title={`${LABELS.tenantTitle} — Plans`}
        description="Available plans with pricing and module entitlements."
        rows={data}
        source={source}
      />
    </div>
  );
}
