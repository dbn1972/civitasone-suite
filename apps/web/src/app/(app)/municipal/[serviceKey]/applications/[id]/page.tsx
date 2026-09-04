import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { CitizenServiceLinks } from "../../../_components/CitizenServiceLinks";
import { RecordDetailPanel } from "../../../_components/RecordDetailPanel";
import { getMunicipalService, officerApplicationsHref } from "../../../_data/services";
import { fetchMunicipalDetail } from "../../../_data/municipalApi";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string; id: string };
};

export default async function MunicipalApplicationDetailPage({ params }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const { data: summary, raw, source } = await fetchMunicipalDetail(config, params.id);

  if (!summary || !raw) {
    return (
      <>
        <PageHeader
          title={config.label}
          subtitle={config.resourceLabel}
          back={officerApplicationsHref(config.serviceKey)}
          actions={source === "error" ? <DataSourceBadge source={source} /> : null}
        />
        <EmptyState
          icon="📄"
          title={source === "error" ? "Could not load record" : "Record not found"}
          message={
            source === "error"
              ? "The municipal service did not return this record. Verify your role and that the gateway route is registered."
              : "This record may have been removed or the identifier is invalid."
          }
        />
      </>
    );
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
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            {config.citizenServiceKey ? (
              <Link href={`/citizen/services/${config.citizenServiceKey}`} className="btn ghost">
                Citizen track
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
        title={summary.title}
        reference={summary.reference}
        status={summary.status}
      />
    </>
  );
}
