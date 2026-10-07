import { PageHeader, LoadErrorState } from "@/app/_components/ds";
import { getFinanceAuditParas } from "@/app/_data/loaders";
import { AuditParasTable } from "./AuditParasTable";
import { AUDIT_PARA_RESPOND_ROLES } from "./auditParaRowAction";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite } from "@/lib/finance/writeRoles";

export default async function AuditParasPage() {
  const result = await getFinanceAuditParas();
  const { data: paras, source } = result;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Audit Paras"
        subtitle="CAG audit observations and department responses."
        back="/finance"
      />
      {/* GAP-FINANCE-AUDIT-PARAS-02: stat cards now live inside AuditParasTable,
          driven by the same useSeededResource call as the rows, so a failed
          load shows a retry state instead of zeros. A 403 is a permission
          decision, not something a retry can fix. */}
      {source === "error" && result.status === 403 ? (
        <LoadErrorState result={result} area="audit paras" backHref="/finance" />
      ) : (
        <AuditParasTable paras={paras} source={source === "error" ? "error" : "api"} canRespond={canWrite(getSessionRoles(), AUDIT_PARA_RESPOND_ROLES)} />
      )}
    </div>
  );
}
