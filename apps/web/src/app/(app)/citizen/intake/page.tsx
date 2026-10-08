import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCatalogueServices } from "../../../_data/citizenPartials";
import { getSessionName, requireAnyRole, CITIZEN_OFFICER_ROLES } from "@/lib/auth/roleGuard";
import { IntakePanel, type IntakeServiceOption } from "./IntakePanel";

/** SVC-082 — Online application & assisted-service intake (draft/ack/tracking). */
export default async function IntakePage() {
  // GAP2-CITIZEN-AUTHZ-ROLEGATE-01: assisted-service intake is an
  // officer/counter tool (the assisting officer is the signed-in staffer; the
  // backend intake surface is OFFICER_ROLES-gated). Gate the web page so a
  // citizen-role user is redirected, not shown a staff tool that 403s.
  requireAnyRole(CITIZEN_OFFICER_ROLES, "/citizen");
  const t = await getTranslations("citizenIntake");
  // GAP-CITIZEN-INTAKE-02: resolve services so the panel offers a by-name
  // picker (with owner department) and can filter channels to the service's
  // enabled channels, instead of a hand-typed Service UUID.
  const { data: services } = await getCatalogueServices();
  const options: IntakeServiceOption[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    ownerDepartment: s.ownerDepartment,
    channels: s.channels,
  }));
  // GAP-CITIZEN-INTAKE-04: the assisting officer is the signed-in user (for
  // counter/assisted channels); shown read-only, never free-typed.
  const assistingOfficer = getSessionName();
  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
      <IntakePanel services={options} assistingOfficer={assistingOfficer} />
    </>
  );
}
