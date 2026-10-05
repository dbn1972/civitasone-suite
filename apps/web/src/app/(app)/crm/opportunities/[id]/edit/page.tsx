import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../../_components/ds";
import { EditOpportunityClient } from "./EditOpportunityClient";

/** OP-003 — edit an existing opportunity (GAP-CRM-OPPORTUNITIES-06). */
export default async function Page({ params }: { params: { id: string } }) {
  const t = await getTranslations("crm.editOpportunity");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm/opportunities"
        backLabel={t("backLabel")}
      />
      <EditOpportunityClient id={params.id} />
    </>
  );
}
