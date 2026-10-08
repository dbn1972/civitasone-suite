import { getTranslations } from "next-intl/server";
import { ModuleHub } from "../../_components/ModuleHub";
import { getSessionRoles, hasAnyRole, ML_INSIGHTS_READ_ROLES } from "@/lib/auth/roleGuard";

// Stable tile keys map to analytics.hub.tiles.* i18n keys. Hrefs stay static;
// only the user-facing label/note is translated (GAP-ANALYTICS-HOME-04).
// Order (GAP-ANALYTICS-HOME-03): dashboards, queries, kpi, data-warehouse,
// then the two insight surfaces last. The "/analytics/list" legacy tile was
// removed (GAP-ANALYTICS-HOME-01 / LIST-01): that route now redirects to
// /analytics/dashboards, so advertising it as a second, differently-behaved
// view of the same endpoint only confused reviewers.
const TILES: { key: string; href: string }[] = [
  { key: "dashboards", href: "/analytics/dashboards" },
  { key: "queries", href: "/analytics/queries" },
  { key: "kpi", href: "/analytics/kpi" },
  { key: "dataWarehouse", href: "/analytics/data-warehouse" },
  { key: "aiInsights", href: "/analytics/ai-insights" },
  { key: "mlInsights", href: "/analytics/ml-insights" },
];

export default async function Page() {
  const t = await getTranslations("analytics.hub");
  // GAP2-ANALYTICS-MLINSIGHTS-01: the ML Insights endpoint only admits
  // ML_INSIGHTS_READ_ROLES (ml-service EVALUATION_ROLES). Hide the tile from a
  // plain analytics reader so the hub does not advertise a surface that would
  // only 403 / show a generic load error; the ml-insights layout re-gates and
  // the ml-service stays the authority.
  const roles = getSessionRoles();
  const canSeeMlInsights = hasAnyRole(roles, ML_INSIGHTS_READ_ROLES);
  const tiles = TILES.filter((tile) => tile.key !== "mlInsights" || canSeeMlInsights);
  return (
    <ModuleHub
      title={t("title")}
      description={t("subtitle")}
      links={tiles.map((tile) => ({
        href: tile.href,
        label: t(`tiles.${tile.key}.label`),
        note: t(`tiles.${tile.key}.note`),
      }))}
    />
  );
}
