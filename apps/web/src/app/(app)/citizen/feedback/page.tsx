import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState } from "../../../_components/ds";

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
      <div className="card">
        <EmptyState
          icon="💬"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
        />
      </div>
    </>
  );
}
