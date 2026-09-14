import { PageHeader, Card } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function PayMatrixLoading() {
  const t = await getTranslations("payMatrix");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("loadingSubtitle")} />
      <Card title={t("loadingCardTitle")}><div className="animate-pulse h-48 bg-slate-100 rounded" /></Card>
    </>
  );
}
