import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantConsentExchange } from "../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { CONSENT_DECISION_ROLES } from "../_roles";
import { ConsentDecisionPanel } from "./ConsentDecisionPanel";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const tc = await getTranslations("tenantW3.consent");
  const { data, source } = await getTenantConsentExchange();
  // OWNER DECISION #19: only the consent officer (DPO) decides on behalf of the
  // data principal; every other role sees the list view-only.
  const canDecide = getSessionRoles().some((r) => CONSENT_DECISION_ROLES.includes(r));
  const pending = data.filter((r) => r.status?.toLowerCase() === "requested").map((r) => ({ id: r.id, label: r.label }));
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{t("office")}</a>
      </nav>
      <ModuleListPage
        title={t("consentExchangeTitle")}
        description={t("consentExchangeSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-consent-exchange"
        source={source}
        errorArea="consent requests"
      >
        {source === "error" ? null : canDecide ? <ConsentDecisionPanel pending={pending} /> : <p role="note" style={{ fontSize: 13 }}>{tc("viewOnly")}</p>}
      </ModuleListPage>
    </div>
  );
}
