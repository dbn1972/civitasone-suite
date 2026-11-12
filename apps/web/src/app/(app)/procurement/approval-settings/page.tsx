import { getTranslations } from "next-intl/server";
import { PageHeader, Card, RefreshErrorState } from "../../../_components/ds";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { ApprovalSettingsForm, type ApprovalSettings, type MatrixRow } from "./ApprovalSettingsForm";

/**
 * M10: procurement without Finance. The approval mode and the limit matrix a
 * purchase order is approved under when the tenant has no Finance module (no
 * budget sanction to cite). Read by procurement staff, changed by procurement
 * admins; a tenant on the finance-sanction path sees its mode here too, and the
 * matrix applies only if an administrator switches local approval on.
 */
const READ_ROLES = ["procurement_officer", "procurement_admin", "super_admin", "audit_officer", "finance_officer"];
const CONFIG_ROLES = ["procurement_admin", "super_admin"];

function mapSettings(p: unknown): ApprovalSettings | null {
  const o = p as Partial<ApprovalSettings> | null;
  if (!o || (o.mode !== "local" && o.mode !== "finance_sanction") || !Array.isArray(o.matrix)) return null;
  return {
    mode: o.mode,
    source: o.source === "override" ? "override" : "derived",
    override: o.override === "local" || o.override === "finance_sanction" ? o.override : null,
    matrix: (o.matrix as MatrixRow[]).map((b) => ({ upToMinor: b.upToMinor === null ? null : String(b.upToMinor), approverRoles: Array.isArray(b.approverRoles) ? b.approverRoles.map(String) : [] })),
    isDefaultMatrix: o.isDefaultMatrix === true,
    pendingOverride: o.pendingOverride && o.pendingOverride.mode === "local" ? { mode: "local", requestedBy: String(o.pendingOverride.requestedBy), requestedAt: String(o.pendingOverride.requestedAt) } : null,
  };
}

export default async function ApprovalSettingsPage() {
  const t = await getTranslations("poApprovalSettings");
  const roles = getSessionRoles();
  if (!roles.some((r) => READ_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module={t("title")} requiredRoles={READ_ROLES} backHref="/procurement" backLabel={t("backLabel")} />
      </div>
    );
  }
  const result = await fetchJson<unknown, ApprovalSettings | null>("/api/v1/procurement/po-approval-settings", null, {
    telemetryKey: "procurement.poApproval.settings",
    mapResponse: mapSettings,
  });
  const settings = result.data;
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/procurement" backLabel={t("backLabel")} />
      <Card title={t("title")}>
        {result.source === "error" || !settings ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "approval settings" })} backHref="/procurement" /></div>
        ) : (
          <div className="pad"><ApprovalSettingsForm initial={settings} canEdit={roles.some((r) => CONFIG_ROLES.includes(r))} /></div>
        )}
      </Card>
    </div>
  );
}
