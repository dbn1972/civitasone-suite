import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantConsentExchange } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantConsentExchange();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Consent Exchange"
        description="Cross-tenant consent requests awaiting decision."
        rows={data}
        source={source}
      />
    </div>
  );
}
