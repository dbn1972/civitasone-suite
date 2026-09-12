import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { IntakePanel } from "./IntakePanel";

/** SVC-082 — Online application & assisted-service intake (draft/ack/tracking). */
export default async function IntakePage() {
  const t = await getTranslations("citizenIntake");
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <IntakePanel />
    </>
  );
}
