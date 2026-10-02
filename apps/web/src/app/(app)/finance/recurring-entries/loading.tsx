import { getTranslations } from "next-intl/server";
import { PageSkeleton } from "../_components/PageSkeleton";

// Mirrors the page (header, stat cards, form, table) so nothing jumps
// when the content arrives. Label is localised via msg.loading.
export default async function Loading() {
  const t = await getTranslations("msg");
  return <PageSkeleton label={t("loading")} statCards={2} formFields={4} rows={5} />;
}
