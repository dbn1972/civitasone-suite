import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, Card } from "../../../_components/ds";

// D3 (CITIZEN-FEEDBACK-03): feedback has no endpoint of its own; the citizen surveys module is the
// feedback channel. The Feedback tile links straight to /citizen/surveys; this page keeps the old URL
// useful by pointing there (a visible page, not a bare redirect).
export default async function CitizenFeedbackPage() {
  const t = await getTranslations("citizenFeedback");
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/citizen" backLabel="Citizen Services" />
      <Card>
        <EmptyState
          icon="💬"
          title={t("movedTitle")}
          message={t("movedMessage")}
          action={<Link href="/citizen/surveys" className="btn primary">{t("movedAction")}</Link>}
        />
      </Card>
    </>
  );
}
