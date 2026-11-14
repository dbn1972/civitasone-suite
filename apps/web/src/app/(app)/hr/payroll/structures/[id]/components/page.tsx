import { notFound } from "next/navigation";
import { PageHeader, RefreshErrorState } from "../../../../../../_components/ds";
import { PermissionDenied } from "../../../../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STAFF_ROLES } from "@/lib/auth/workRoles";
import { PAYROLL_PAY_DATA_ROLES } from "@/lib/auth/payrollRunRoles";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import type { ComponentRow } from "@/lib/payComponents";
import { ComponentManager, type StructureCheck, type StructureView } from "./ComponentManager";

/**
 * Section 8 G2: manage the components of one pay structure or CTC template.
 * Reads: payroll-service PAY_DATA_ROLES. Writes: PAYROLL_STAFF_ROLES. Lock (approve): payroll_admin / super_admin.
 * The API answers 404 PAY_COMPONENTS_DISABLED while S8_PAY_COMPONENTS_ENABLED is off, and this page then 404s.
 */
const LOCK_ROLES = ["payroll_admin", "super_admin"];
type Detail = { structure: StructureView; components: ComponentRow[]; check: StructureCheck };

export default async function StructureComponentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("payComponents");
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_PAY_DATA_ROLES.includes(r))) {
    return <PermissionDenied module="pay structures" requiredRoles={PAYROLL_PAY_DATA_ROLES} />;
  }
  const res = await fetchJson<unknown, Detail | null>(`/api/v1/payroll/structures/${encodeURIComponent(id)}/components`, null, {
    telemetryKey: "payroll.structure-components",
    mapResponse: (p) => {
      const d = p as Partial<Detail> | undefined;
      return d && d.structure && Array.isArray(d.components) ? { structure: d.structure, components: d.components, check: d.check ?? { errors: [], warnings: [] } } : null;
    },
  });
  if (res.source === "error" || !res.data) {
    // 404 (flag off, or no such structure) is indistinguishable from an outage here; the flag-off case must not look broken.
    if (res.source !== "error") notFound();
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/structures" backLabel={t("backLabel")} />
        <RefreshErrorState error={toHumanError("load", { area: "pay components" })} backHref="/hr/payroll/structures" />
      </div>
    );
  }
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/structures" backLabel={t("backLabel")} />
      <ComponentManager
        structure={res.data.structure}
        components={res.data.components}
        check={res.data.check}
        canWrite={roles.some((r) => PAYROLL_STAFF_ROLES.includes(r))}
        canLock={roles.some((r) => LOCK_ROLES.includes(r))}
      />
    </div>
  );
}
