import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { CitizenServiceLinks } from "../../../_components/CitizenServiceLinks";
import { RecordDetailPanel } from "../../../_components/RecordDetailPanel";
import { RecordActions } from "../../../_components/RecordActions";
import { RecordHistory } from "../../../_components/RecordHistory";
import { getMunicipalService, officerApplicationsHref, citizenServiceHref } from "../../../_data/services";
import { fetchMunicipalDetail, fetchMunicipalHistory } from "../../../_data/municipalApi";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string; id: string };
};

export default async function MunicipalApplicationDetailPage({ params }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const { data: summary, raw, source, status } = await fetchMunicipalDetail(config, params.id);

  if (!summary || !raw) {
    // GAP-...-DETAIL-05: a real 404 is "this record doesn't exist" — use the
    // municipal not-found. Any other failure (5xx/403/network) keeps the user
    // on the page with an honest retry.
    if (source === "error" && status === 404) notFound();
    if (source === "error") {
      return (
        <>
          <PageHeader
            title={config.label}
            subtitle={config.resourceLabel}
            back={officerApplicationsHref(config.serviceKey)}
          />
          {/* GAP-...-DETAIL-04: RefreshErrorState (real retry), no "verify your
              role and that the gateway route is registered" developer copy. A
              403 is rendered as a permission message via the status source. */}
          <RefreshErrorState
            error={toHumanError(status === 403 ? "forbidden" : "load", { area: "this record" })}
            backHref={officerApplicationsHref(config.serviceKey)}
            source={{ status, area: "this record" }}
          />
        </>
      );
    }
    // Healthy fetch that simply returned nothing → not found.
    notFound();
  }

  return (
    <>
      <PageHeader
        title={summary.title}
        subtitle={`${config.label} · ${summary.reference}`}
        back={officerApplicationsHref(config.serviceKey)}
        actions={
          <>
            <StatusPill status={summary.status} />
            {config.citizenServiceKey ? (
              <Link href={citizenServiceHref(config.citizenServiceKey)} className="btn ghost">
                Citizen service page
              </Link>
            ) : null}
          </>
        }
      />

      {config.citizenServiceKey ? (
        <div style={{ marginBottom: 16 }}>
          <CitizenServiceLinks config={config} />
        </div>
      ) : null}

      <RecordDetailPanel
        record={raw}
        config={config}
        title={summary.title}
        reference={summary.reference}
        status={summary.status}
      />

      {/* GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02: officer workflow
          actions + a history timeline — only for services whose backend exposes
          the per-service action/history endpoints (config.workflow). Actions are
          gated to officer roles here (UI) AND re-enforced by the service on every
          route. Services without workflow endpoints keep the honest read-only
          panel with no action buttons. */}
      {config.workflow ? await renderWorkflow(config, params.id, summary.status) : null}
    </>
  );
}

async function renderWorkflow(
  config: NonNullable<ReturnType<typeof getMunicipalService>>,
  id: string,
  status: string,
) {
  if (!config.workflow) return null;
  const roles = getSessionRoles();
  const canAct = roles.some((r) => config.workflow!.officerRoles.includes(r));
  const { events } = await fetchMunicipalHistory(config, id);
  return (
    <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
      {canAct ? (
        <RecordActions applicationId={id} status={status} workflow={config.workflow} />
      ) : null}
      <RecordHistory events={events} />
    </div>
  );
}
