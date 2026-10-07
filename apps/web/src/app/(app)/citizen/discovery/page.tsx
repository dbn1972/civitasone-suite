import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCatalogueServices } from "../../../_data/citizenPartials";
import { DiscoveryPanel } from "./DiscoveryPanel";

/** SVC-090 — Proactive service & benefit discovery (consent-gated). */
export default async function DiscoveryPage() {
  const t = await getTranslations("citizenDiscovery");
  // GAP-CITIZEN-DISCOVERY-03: resolve service id → name so matches show names,
  // not raw UUIDs. Best-effort: on a load error the map is empty and matches
  // fall back to the id (never crashes the page).
  const { data: services } = await getCatalogueServices();
  const serviceNames = Object.fromEntries(services.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <DiscoveryPanel serviceNames={serviceNames} />
    </>
  );
}
