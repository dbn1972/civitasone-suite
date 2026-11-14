import { getTranslations } from "next-intl/server";
import { MODULE_CATALOGUE } from "@civitasone/schemas/module-catalogue";
import { PageHeader, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getPlanList, getPlanModules, getPlanQuote } from "@/app/_data/planPricingLoaders";
import { formatMoney } from "@/lib/formatters";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

const NAME = new Map(MODULE_CATALOGUE.map((m) => [m.id, m.name]));
const label = (id: string): string => NAME.get(id) ?? id;

/**
 * M6: each plan is sold as a set of catalogue modules (hard dependencies pulled in) at an effective-dated price in
 * rupees with GST shown separately. Read-only here: applying a plan to a tenant is maker-checker (admin-service), and
 * price entry is POST /v1/plans/prices.
 */
export default async function PlanPricingPage() {
  const t = await getTranslations("planPricing");
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title={t("title")} area={t("area")} roles={PLATFORM_ADMIN_ROLES} />;
  }
  const list = await getPlanList();
  if (list.source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/admin" />
        <LoadErrorState result={{ status: list.status, errorMessage: list.errorMessage }} area={t("area")} backHref="/admin" />
      </div>
    );
  }
  const rows = await Promise.all(list.data.map(async (p) => ({ p, mods: (await getPlanModules(p.id)).data, quote: (await getPlanQuote(p.id)).data })));
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/admin" />
      {rows.length === 0 ? (
        <EmptyState icon="🏷️" title={t("empty.title")} message={t("empty.message")} />
      ) : (
        rows.map(({ p, mods, quote }) => (
          <Card key={p.id} title={`${p.name} (${p.code})`} padding>
            <div className="fields">
              <div className="field">
                <span className="label">{t("includes")}</span>
                <span>{mods && mods.selected.length > 0 ? mods.selected.map(label).join(", ") : t("none")}</span>
              </div>
              <div className="field">
                <span className="label">{t("addedAutomatically")}</span>
                <span>{mods && mods.pulledIn.length > 0 ? mods.pulledIn.map(label).join(", ") : t("none")}</span>
              </div>
              {quote ? (
                <>
                  <div className="field"><span className="label">{t("netPrice")}</span><span>{formatMoney(quote.totals.netMinor)}</span></div>
                  <div className="field"><span className="label">{t("gst")}</span><span>{formatMoney(quote.totals.gstMinor)}</span></div>
                  <div className="field"><span className="label">{t("totalPrice")}</span><span>{formatMoney(quote.totals.grossMinor)}</span></div>
                  <div className="field"><span className="label">{t("billingCycle")}</span><span>{t(`cycle.${quote.billingCycle}`)}</span></div>
                </>
              ) : (
                <div className="field"><span className="label">{t("netPrice")}</span><span>{t("noPrice")}</span></div>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
