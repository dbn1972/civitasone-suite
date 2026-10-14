import { getTranslations } from "next-intl/server";
import { ModuleHub } from "../../_components/ModuleHub";

export default async function Page() {
  const t = await getTranslations("locationsHub");
  return (
    <ModuleHub
      title={t("title")}
      description={t("description")}
      help="locations"
      links={[
        { href: "/locations/list", label: t("listLabel"), note: t("listNote") },
        { href: "/locations/geofences", label: t("geofencesLabel"), note: t("geofencesNote") },
        { href: "/locations/jurisdictions", label: t("jurisdictionsLabel"), note: t("jurisdictionsNote") },
        { href: "/locations/infrastructure", label: t("infrastructureLabel"), note: t("infrastructureNote") },
        { href: "/locations/maps", label: t("mapLabel"), note: t("mapNote") },
        { href: "/locations/maps/monitoring", label: t("monitoringLabel"), note: t("monitoringNote") },
      ]}
    />
  );
}
