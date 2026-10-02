import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/app/_components/ds";
import { VendorForm } from "./VendorForm";

export default async function NewVendorPage() {
  const t = await getTranslations("financeVendorForm");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/finance/vendors" backLabel={t("backLabel")} />
      <VendorForm />
    </div>
  );
}
