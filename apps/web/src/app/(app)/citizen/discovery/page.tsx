import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { DiscoveryPanel } from "./DiscoveryPanel";

/** SVC-090 — Proactive service & benefit discovery (consent-gated). */
export default async function DiscoveryPage() {
  const t = await getTranslations("citizenDiscovery");
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <DiscoveryPanel />
    </>
  );
}
