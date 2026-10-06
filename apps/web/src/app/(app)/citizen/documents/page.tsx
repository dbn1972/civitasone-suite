import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCatalogueServices } from "../../../_data/citizenPartials";
import { DocumentPanel, type DocumentServiceOption } from "./DocumentPanel";

/** SVC-084 — Document submission & verification. */
export default async function DocumentsPage() {
  const t = await getTranslations("citizenDocuments");
  // GAP-CITIZEN-DOCUMENTS-03: resolve services server-side so the panel can
  // offer a by-name picker instead of a hand-typed Service UUID. On load error
  // the list is empty and the panel shows an inline explanation.
  const { data: services } = await getCatalogueServices();
  const options: DocumentServiceOption[] = services.map((s) => ({ id: s.id, name: s.name, serviceKey: s.serviceKey }));
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <DocumentPanel services={options} />
    </>
  );
}
