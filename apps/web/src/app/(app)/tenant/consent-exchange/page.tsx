import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantConsentExchange } from "../_data";
import { LABELS } from "@/lib/labels";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantConsentExchange();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{LABELS.tenantTitle}</a>
      </nav>
      <ModuleListPage
        title={`${LABELS.tenantTitle} — Consent Exchange`}
        description="Cross-organisation consent requests (read-only)."
        rows={data}
        source={source}
      />
    </div>
  );
}
