import { getTranslations } from "next-intl/server";
import { PayrollPageSkeleton } from "../_lib/PayrollPageSkeleton";

export default async function Loading() {
  const t = await getTranslations("payrollDdos");
  return (
    <PayrollPageSkeleton
      title={t("title")}
      subtitle={t("subtitle")}
      backLabel={t("backLabel")}
      loadingLabel={t("loadingAriaLabel")}
    />
  );
}
