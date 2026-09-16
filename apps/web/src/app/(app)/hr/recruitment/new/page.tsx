import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card } from "../../../../_components/ds";
import { NewJobOpeningForm } from "./NewJobOpeningForm";

export default async function NewJobOpeningPage() {
  const t = await getTranslations("recruitmentNewJob");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/recruitment"
      />
      <Card>
        <Suspense fallback={<div className="text-sm text-slate-500">{t("loadingForm")}</div>}>
          <NewJobOpeningForm />
        </Suspense>
      </Card>
    </main>
  );
}
