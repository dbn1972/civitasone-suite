import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { CitizenServiceLinks } from "../../_components/CitizenServiceLinks";
import { RecordsTable } from "../../_components/RecordsTable";
import { getMunicipalService } from "../../_data/services";
import { fetchMunicipalList } from "../../_data/municipalApi";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string };
};

export default async function MunicipalApplicationsPage({ params }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const { data: list, source } = await fetchMunicipalList(config);

  return (
    <>
      <PageHeader
        title={`${config.label} — ${config.resourceLabel}`}
        subtitle={`Live list from ${config.listPath}`}
        back={`/municipal/${config.serviceKey}`}
        actions={
          <>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            {config.citizenServiceKey ? (
              <Link href={`/citizen/services/${config.citizenServiceKey}/apply`} className="btn ghost">
                Citizen apply
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

      <Card title={config.resourceLabel}>
        {source === "error" ? (
          <div className="pad">
            <EmptyState
              icon="⚠️"
              title={`Could not load ${config.resourceLabel.toLowerCase()}`}
              message="Check that you are signed in with the correct municipal role and the service is running behind the gateway."
            />
          </div>
        ) : (
          <div className="pad">
            <RecordsTable config={config} rows={list.rows} />
          </div>
        )}
      </Card>
    </>
  );
}
