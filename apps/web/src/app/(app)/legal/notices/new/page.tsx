import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { NewNoticeForm } from "./NewNoticeForm";

export default async function NewNoticePage() {
  const t = await getTranslations("legalNotices");
  return (
    <div className="wrap">
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} back="/legal/notices" />
      <NewNoticeForm />
    </div>
  );
}
