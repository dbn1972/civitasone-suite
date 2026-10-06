import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, Card } from "../../../_components/ds";

export default async function CitizenFeedbackPage() {
  const t = await getTranslations("citizenFeedback");
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/citizen"
        backLabel="Citizen Services"
      />
      <Card>
        <EmptyState
          icon="💬"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
          action={
            <Link href="/citizen/grievances" className="btn primary">
              {t("actionLabel")}
            </Link>
          }
        />
      </Card>
    </>
  );
}
