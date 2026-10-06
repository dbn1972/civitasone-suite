import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/app/_components/ds";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { classifyServiceLoad, loadService } from "../../_data/loadService";
import { ServiceRuntimeFlow } from "../../_components/ServiceRuntimeFlow";

interface Props {
  params: { serviceKey: string };
  searchParams: { counter?: string };
}

// GAP-...-SERVICES-SERVICEKEY-APPLY-04: counter (assisted) mode must be an
// authenticated officer, not anyone who appends ?counter=1. Mirrors the
// citizen-service OFFICER_TIER_ROLES; the server is still authoritative
// (assisted intake returns 403 for a non-officer), this is the web gate.
const OFFICER_TIER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

/** FN-13 — pack-driven apply flow (FormRenderer stepped → review → fee → submitted). */
export default async function ServiceApplyPage({ params, searchParams }: Props) {
  const t = await getTranslations("citizenServices");
  const outcome = classifyServiceLoad(
    await loadService(params.serviceKey, { revalidateSeconds: 0, telemetryKey: "citizen.runtime.apply" }),
  );
  if (outcome.kind === "not_found") notFound();
  if (outcome.kind === "unauthorized") {
    redirect(`/login?next=/citizen/services/${params.serviceKey}/apply`);
  }
  if (outcome.kind === "unavailable") {
    return (
      <>
        <PageHeader
          title={t("applyPageSubtitle")}
          actions={
            <Link href={`/citizen/services/${params.serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
              {t("backToServiceInfo")}
            </Link>
          }
        />
        <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <RefreshErrorState
            error={toHumanError("load", { area: "service details" })}
            backHref={`/citizen/services/${params.serviceKey}`}
            source={{ status: outcome.status, area: "service details" }}
          />
        </div>
      </>
    );
  }
  const service = outcome.service;

  const wantsCounter = searchParams.counter === "1";
  const isOfficer = getSessionRoles().some((r) => OFFICER_TIER_ROLES.includes(r));
  // A non-officer who appends ?counter=1 is redirected to the normal (citizen)
  // apply flow rather than silently running assisted mode.
  if (wantsCounter && !isOfficer) {
    redirect(`/citizen/services/${params.serviceKey}/apply`);
  }
  const counterMode = wantsCounter && isOfficer;
  const assistedBy = counterMode ? getSessionUserId() : null;

  return (
    <>
      <PageHeader
        title={t("applyPageTitle", { name: service.name })}
        subtitle={t("applyPageSubtitle")}
        actions={
          <Link href={`/citizen/services/${params.serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
            {t("backToServiceInfo")}
          </Link>
        }
      />
      <ServiceRuntimeFlow service={service} counterMode={counterMode} assistedBy={assistedBy} />
    </>
  );
}
