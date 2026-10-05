import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { ServiceTypesEditor } from "../../../_components/crm/ServiceTypesEditor";

/** GAP-CRM-SERVICE-REQUESTS-NEW-02 — service-type master admin. */
export default async function Page() {
  const t = await getTranslations("crmServiceTypesPage");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      <ServiceTypesEditor />
    </>
  );
}
