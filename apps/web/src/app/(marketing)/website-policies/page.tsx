import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GigwPage } from "../_gigw/GigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0 website policies). DEFERRED-content: every policy text is owner-supplied.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gigw");
  return { title: `${t("policiesTitle")} | CivitasOne` };
}

export default async function WebsitePoliciesPage() {
  const t = await getTranslations("gigw");
  return (
    <GigwPage
      title={t("policiesTitle")}
      pendingNotice={t("pendingNotice")}
      pendingSection={t("pendingSection")}
      sections={[
        { id: "privacy", heading: t("privacyHeading") },
        { id: "terms", heading: t("termsHeading") },
        { id: "hyperlinking", heading: t("hyperlinkHeading") },
        { id: "copyright", heading: t("copyrightHeading") },
        { id: "archival", heading: t("archivalHeading") },
        { id: "disclaimer", heading: t("disclaimerHeading") },
      ]}
    />
  );
}
