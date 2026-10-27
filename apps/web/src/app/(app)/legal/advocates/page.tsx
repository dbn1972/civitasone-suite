import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { AdvocatesManager } from "./AdvocatesManager";

export default async function LegalAdvocatesPage() {
  const t = await getTranslations("legalAdvocates");
  return (
    <div className="wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/legal/list" />
      <AdvocatesManager />
    </div>
  );
}
