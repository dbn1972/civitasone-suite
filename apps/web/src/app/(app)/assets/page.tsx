import { getTranslations } from "next-intl/server";
import { ModuleHub, type ModuleHubGroup } from "../../_components/ModuleHub";

/** Hub tiles: [route, message key under assets.links]. Grouping lives in GROUPS. */
const ROUTES = {
  dashboard: "/assets/dashboard",
  register: "/assets/register",
  bulkImport: "/assets/bulk-import",
  scan: "/assets/scan",
  verification: "/assets/verification",
  list: "/assets/list",
  fixedAssets: "/assets/fixed-assets",
  infra: "/assets/infra",
  locations: "/assets/locations",
  leases: "/assets/leases",
  projects: "/assets/projects",
  maintenance: "/assets/maintenance",
  fleet: "/assets/fleet",
  insurance: "/assets/insurance",
  depreciation: "/assets/depreciation",
  condemnation: "/assets/condemnation",
} as const;

type LinkKey = keyof typeof ROUTES;

/** GAP-ASSETS-HOME-01: five headed groups covering all 16 tiles exactly once. */
const GROUPS: { key: string; links: LinkKey[] }[] = [
  { key: "overview", links: ["dashboard"] },
  { key: "register", links: ["register", "bulkImport", "scan", "verification"] },
  { key: "registers", links: ["list", "fixedAssets", "infra", "locations", "leases", "projects"] },
  { key: "operate", links: ["maintenance", "fleet", "insurance"] },
  { key: "account", links: ["depreciation", "condemnation"] },
];

export default async function Page() {
  const t = await getTranslations("assets");
  // GAP-ASSETS-HOME-02: every label comes from the message catalogue.
  const groups: ModuleHubGroup[] = GROUPS.map((g) => ({
    heading: t(`groups.${g.key}`),
    links: g.links.map((k) => ({ href: ROUTES[k], label: t(`links.${k}.label`), note: t(`links.${k}.note`) })),
  }));
  return <ModuleHub title={t("title")} description={t("description")} groups={groups} />;
}
