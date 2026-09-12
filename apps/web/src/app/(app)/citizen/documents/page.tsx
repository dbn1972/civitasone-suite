import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { DocumentPanel } from "./DocumentPanel";

/** SVC-084 — Document submission & verification. */
export default async function DocumentsPage() {
  const t = await getTranslations("citizenDocuments");
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <DocumentPanel />
    </>
  );
}
