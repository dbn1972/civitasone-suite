import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getAuditExports } from "../../../_data/loaders";
import { getSessionRoles, hasAnyRole, AUDIT_PII_EXPORT_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { ExportConsole } from "./ExportConsole";
import { ExportsTable, type ExportRow } from "./ExportsTable";
import { AuditBreadcrumb } from "../_components/AuditBreadcrumb";

export default async function AuditExportsPage() {
  const { data: items, source } = await getAuditExports();
  // GAP-AUDIT-EXPORTS-02: only offer PII columns to roles the server will
  // honour (PII_EXPORT_ROLES). UI gating is advisory; the audit-service
  // re-checks the role and rejects otherwise.
  const canExportPii = hasAnyRole(getSessionRoles(), AUDIT_PII_EXPORT_ROLES);

  const rows = items as ExportRow[];

  return (
    <div className="wrap">
      <AuditBreadcrumb current="Compliance Export" />
      <PageHeader
        title="Compliance Export"
        subtitle="Generate signed, tamper-evident audit exports for regulators."
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <ExportConsole canExportPii={canExportPii} />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Recent exports</h3></div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "export jobs" })} />
        ) : rows.length === 0 ? (
          <EmptyState icon="📤" title="No export jobs" message="Generated exports will appear here." />
        ) : (
          <ExportsTable rows={rows} />
        )}
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: "12.5px", color: "var(--ink2)" }}>Exports are cryptographically signed (HMAC) with a 7-year retention lock (WORM). Use the "Verify" action on any completed row to re-validate its artifact against the stored signature.</div>
        </div>
      </div>
    </div>
  );
}
