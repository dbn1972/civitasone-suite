import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("payrollCosting");
  return <div className="page-main wrap"><div className="skeleton" aria-label={t("loadingAriaLabel")} /></div>;
}
