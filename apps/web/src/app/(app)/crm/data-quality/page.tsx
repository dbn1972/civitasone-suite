import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { DataQualityView } from "../../../_components/crm/DataQualityView";
import { getSessionRoles, CRM_ADMIN_ROLES, hasAnyRole } from "@/lib/auth/roleGuard";

/** DQ-004 — Data Quality dashboard. */
export default async function Page() {
  // GAP-CRM-DATA-QUALITY-07: title from next-intl (crm.dataQuality.title) instead
  // of the hard-coded 'Data Quality • डेटा गुणवत्ता' literal, so the active
  // locale's string is shown (en/hi today; ta/te/kn fall back to English).
  const t = await getTranslations("crm.dataQuality");
  // GAP-CRM-DATA-QUALITY-05: the 'Matching rules' link targets an admin-only
  // route (dedup-rules/layout gates on the same admin set) that redirects a
  // plain crm_user straight back here with no explanation. Only offer the link
  // to roles that can actually reach it. The layout guard remains the real
  // boundary; this just stops a dead-end redirect.
  const canManageRules = hasAnyRole(getSessionRoles(), CRM_ADMIN_ROLES);
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle="Completeness, format and freshness of the contact, account and stakeholder masters — ensuring data integrity for GoI reporting"
        back="/crm"
        backLabel="CRM"
        actions={canManageRules ? <a className="btn ghost" href="/crm/dedup-rules">Matching rules</a> : undefined}
      />
      <div
        role="note"
        aria-label="Data quality context"
        className="flex items-start gap-2.5 mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800"
      >
        <span>
          Regular data quality checks ensure accurate reporting for Ministry dashboards and RTI disclosures.
        </span>
      </div>
      <DataQualityView />
    </>
  );
}
