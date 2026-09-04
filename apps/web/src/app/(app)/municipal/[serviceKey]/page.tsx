import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, StatGrid } from "@/app/_components/ds";
import { CitizenServiceLinks } from "../_components/CitizenServiceLinks";
import { getMunicipalService, officerApplicationsHref } from "../_data/services";
import { fetchMunicipalList } from "../_data/municipalApi";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string };
};

export default async function MunicipalServiceHomePage({ params }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const { data: list, source } = await fetchMunicipalList(config);
  const pending = list.rows.filter((r) => !["approved", "issued", "completed", "closed", "resolved"].includes(r.status.toLowerCase())).length;

  return (
    <>
      <PageHeader
        title={config.label}
        subtitle={config.description}
        back="/municipal"
        actions={
          <Link href={officerApplicationsHref(config.serviceKey)} className="btn primary">
            View {config.resourceLabel}
          </Link>
        }
      />

      <StatGrid>
        <StatCard icon={config.icon} iconBg="#eef2ff" label="Total records" value={list.meta.total || list.rows.length} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="In progress" value={pending} />
        <StatCard icon="🔗" iconBg="#ecfdf5" label="API" value={source === "api" ? "Live" : "Unavailable"} />
      </StatGrid>

      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        <CitizenServiceLinks config={config} />

        <Card title="Officer workspace" padding>
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 0 }}>
            Scrutiny queues, approvals and permits for {config.label} are exposed via{" "}
            <code style={{ fontSize: 12 }}>{config.listPath}</code> through the gateway.
          </p>
          <Link href={officerApplicationsHref(config.serviceKey)} className="btn ghost">
            Open {config.resourceLabel} list →
          </Link>
        </Card>
      </div>
    </>
  );
}
