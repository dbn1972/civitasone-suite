import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { OpportunityViews } from "../../../_components/crm/OpportunityViews";
import { getSessionRoles, hasAnyRole, CRM_OPPORTUNITY_CLOSE_ROLES } from "@/lib/auth/roleGuard";

/** OP-004 — Kanban board, list, calendar and funnel views over the pipeline. */
export default async function Page() {
  const t = await getTranslations("crmOpportunitiesPage");
  // GAP-CRM-OPPORTUNITIES-03: closing a deal is irreversible and feeds revenue
  // reporting, so the Close control is only offered to CRM admins. The server
  // close endpoint remains the authority.
  const canClose = hasAnyRole(getSessionRoles(), CRM_OPPORTUNITY_CLOSE_ROLES);
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
        actions={<a className="btn primary" href="/crm/opportunities/new">{t("newOpportunity")}</a>}
      />
      <OpportunityViews canClose={canClose} />
    </>
  );
}
