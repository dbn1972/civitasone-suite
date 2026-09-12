import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/app/_components/ds";

export default async function CitizenNotFound() {
  const t = await getTranslations("citizen");
  return (
    <EmptyState
      title={t("notFoundTitle")}
      message={t("notFoundMessage")}
    />
  );
}
