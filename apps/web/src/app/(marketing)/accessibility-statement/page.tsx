import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GigwPage } from "../_gigw/GigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0). DEFERRED-content: section text to be supplied by the owner.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gigw");
  return { title: `${t("accessibilityTitle")} | CivitasOne` };
}

export default async function AccessibilityStatementPage() {
  const t = await getTranslations("gigw");
  return (
    <GigwPage
      title={t("accessibilityTitle")}
      intro={t("accessibilityIntro")}
      pendingNotice={t("pendingNotice")}
      pendingSection={t("pendingSection")}
      sections={[
        { id: "conformance", heading: t("conformanceHeading") },
        { id: "known-issues", heading: t("knownIssuesHeading") },
        { id: "feedback", heading: t("feedbackHeading") },
        { id: "statement-date", heading: t("statementDateHeading") },
      ]}
    />
  );
}
