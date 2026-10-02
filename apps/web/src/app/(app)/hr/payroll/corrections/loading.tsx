import { getTranslations } from "next-intl/server";
import { PayrollPageSkeleton } from "../_lib/PayrollPageSkeleton";

export default async function Loading() {
  const t = await getTranslations("corrections");
  return (
    <PayrollPageSkeleton
      title={t("title")}
      subtitle={t("subtitle")}
      backLabel={t("backLabel")}
      loadingLabel={t("loadingAriaLabel")}
      statCount={4}
    />
  );
}
