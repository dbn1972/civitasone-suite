import type { NavTile } from "@civitasone/types";
import { getTranslations } from "next-intl/server";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles, CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-CITIZEN-HOME-01: previously eight routes under /citizen (catalogue,
 * intake, documents, eligibility, payments, certificates, discovery, appeals)
 * had no tile and no in-app link — reachable only by typing the URL. They are
 * now surfaced here, grouped by section. GAP-CITIZEN-HOME-03: this page used
 * the legacy PageShell (slate bg, text-3xl); it now uses the shared ds
 * PageHeader like every sibling route.
 *
 * GAP2-CITIZEN-AUTHZ-ROLEGATE-01: discovery, intake and payments are
 * officer/clerk tools (their backend surfaces are OFFICER_ROLES-gated and the
 * pages now carry a web requireAnyRole). A citizen-role user must NOT see them
 * as "citizen features" and then hit a 403 on every fetch — they are hidden
 * here for non-officer roles. The role list mirrors CITIZEN_OFFICER_ROLES and
 * each page's own server-authoritative gate.
 */
const OFFICER_ONLY_HREFS = new Set(["/citizen/discovery", "/citizen/intake", "/citizen/payments"]);

export default async function Page() {
  const t = await getTranslations("citizen");
  const roles = getSessionRoles();
  const isOfficer = CITIZEN_OFFICER_ROLES.some((r) => roles.includes(r));

  const citizenTiles: NavTile[] = [
    // Service delivery (SVC-081..090).
    { title: t("tileCatalogue"), href: "/citizen/catalogue", section: t("sectionServiceDelivery") },
    { title: t("tileIntake"), href: "/citizen/intake", section: t("sectionServiceDelivery") },
    { title: t("tileDocuments"), href: "/citizen/documents", section: t("sectionServiceDelivery") },
    { title: t("tileEligibility"), href: "/citizen/eligibility", section: t("sectionServiceDelivery") },
    { title: t("tilePayments"), href: "/citizen/payments", section: t("sectionServiceDelivery") },
    { title: t("tileCertificates"), href: "/citizen/certificates", section: t("sectionServiceDelivery") },
    { title: t("tileDiscovery"), href: "/citizen/discovery", section: t("sectionServiceDelivery") },
    { title: t("tileAppeals"), href: "/citizen/appeals", section: t("sectionServiceDelivery") },
    // Grievance / RTI / engagement.
    { title: t("tileRequests"), href: "/citizen/requests", section: t("sectionEngagement") },
    { title: t("tileRti"), href: "/citizen/rti", section: t("sectionEngagement") },
    { title: t("tileGrievances"), href: "/citizen/grievances", section: t("sectionEngagement") },
    { title: t("tileFeedback"), href: "/citizen/feedback", section: t("sectionEngagement") },
    { title: t("tilePortal"), href: "/citizen/portal", section: t("sectionEngagement") },
    { title: t("tileAlerts"), href: "/citizen/alerts", section: t("sectionEngagement") },
    { title: t("tileNotices"), href: "/citizen/notices", section: t("sectionEngagement") },
    { title: t("tileSurveys"), href: "/citizen/surveys", section: t("sectionEngagement") },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} help="citizen" />
      <LinkTiles tiles={citizenTiles.filter((tile) => isOfficer || !OFFICER_ONLY_HREFS.has(tile.href))} />
    </>
  );
}
