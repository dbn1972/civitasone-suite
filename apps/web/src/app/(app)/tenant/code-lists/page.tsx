import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantCodeLists } from "../_data";
import { LABELS } from "@/lib/labels";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantCodeLists();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{LABELS.tenantTitle}</a>
      </nav>
      <ModuleListPage
        title={`${LABELS.tenantTitle} — Code Lists`}
        description="Reference code lists and their dated values."
        rows={data}
        source={source}
      />
    </div>
  );
}
