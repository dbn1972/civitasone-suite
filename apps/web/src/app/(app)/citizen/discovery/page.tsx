import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCatalogueServices } from "../../../_data/citizenPartials";
import { requireAnyRole, CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";
import { DiscoveryPanel } from "./DiscoveryPanel";

/** SVC-090 — Proactive service & benefit discovery (consent-gated). */
export default async function DiscoveryPage() {
  // GAP2-CITIZEN-AUTHZ-ROLEGATE-01: this is a clerk tool (the officer types an
  // arbitrary citizen's UUID to discover their eligible services), not a
  // citizen self-service screen — the whole backend surface
  // (discovery/routes.ts) is OFFICER_ROLES-gated. Gate the web page too so a
  // citizen-role user gets a PermissionDenied redirect, not a 403 on every
  // fetch. The server stays authoritative.
  requireAnyRole(CITIZEN_OFFICER_ROLES, "/citizen");
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
