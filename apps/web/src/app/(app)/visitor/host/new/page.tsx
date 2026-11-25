import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles, getSessionUserId, hasAnyRole } from "@/lib/auth/roleGuard";
import { getVisitorLocations } from "../../_data/loaders";
import { NewVisitRequestForm } from "./NewVisitRequestForm";

export const dynamic = "force-dynamic";

// Mirror visitor-service visit-request/routes.ts: WRITE_ROLES gate the create
// route; VIP_GRANT_ROLES alone may set visitorCategory "vip".
const WRITE_ROLES = ["employee", "security_admin", "protocol_officer", "tenant_admin", "super_admin"];
const VIP_GRANT_ROLES = ["protocol_officer", "security_admin", "tenant_admin", "super_admin"];

export default async function NewVisitRequestPage() {
  const t = await getTranslations("visitor.newRequest");
  const locations = await getVisitorLocations();
  const roles = getSessionRoles();
  const me = getSessionUserId();

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/visitor/host" backLabel={t("backToHost")} />
      {locations.source === "error" && (
        <RefreshErrorState
          error={{ what: t("locationsError"), next: t("locationsErrorNext"), actions: ["retry"] }}
        />
      )}
      {!hasAnyRole(roles, WRITE_ROLES) || !me ? (
        <p className="sub" role="note">{t("noAccess")}</p>
      ) : (
        <NewVisitRequestForm
          hostEmployeeId={me}
          locations={locations.data.map((l) => ({ id: l.id, name: l.name }))}
          canGrantVip={hasAnyRole(roles, VIP_GRANT_ROLES)}
        />
      )}
    </>
  );
}
