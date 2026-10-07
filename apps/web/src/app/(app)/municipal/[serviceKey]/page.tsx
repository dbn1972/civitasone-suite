import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, StatGrid, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { CitizenServiceLinks } from "../_components/CitizenServiceLinks";
import { getMunicipalService, officerApplicationsHref } from "../_data/services";
import { fetchMunicipalList } from "../_data/municipalApi";
import { countInProgress } from "../_data/records";

export const dynamic = "force-dynamic";

type Props = {
  params: { serviceKey: string };
};

export default async function MunicipalServiceHomePage({ params }: Props) {
  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  const t = await getTranslations("municipal.service");
  const { data: list, source } = await fetchMunicipalList(config);
  const failed = source === "error";

  // GAP-MUNICIPAL-SERVICEKEY-02: count only genuinely-pending rows (terminal
  // and unknown states excluded), and because the list is page-scoped (only
  // page 1 is fetched here), label the figure as "this page" whenever the
  // total exceeds the rows actually loaded, so officers never read a page
  // count as a whole-service workload.
  const inProgress = countInProgress(list.rows);
  const pageScoped = list.meta.total > list.rows.length;
  const inProgressLabel = pageScoped ? t("inProgressThisPage") : t("inProgress");

  // GAP-MUNICIPAL-SERVICEKEY-01: on failure, show "—" (not a fabricated 0) and
  // a real retry via RefreshErrorState, instead of presenting 0/0 as facts.
  const totalValue = failed ? "—" : list.meta.total || list.rows.length;
  const inProgressValue = failed ? "—" : inProgress;

  return (
    <>
      <PageHeader
        title={config.label}
        subtitle={config.description}
        back="/municipal"
        actions={
          <Link href={officerApplicationsHref(config.serviceKey)} className="btn primary">
            {t("viewResource", { resource: config.resourceLabel })}
          </Link>
        }
      />

      {failed ? (
        <div style={{ marginBottom: 16 }}>
          <RefreshErrorState
            error={toHumanError("load", { area: config.label })}
            backHref="/municipal"
            source={{ area: config.label }}
          />
        </div>
      ) : null}

      <StatGrid>
        <StatCard icon={config.icon} iconBg="#eef2ff" label={t("totalRecords")} value={totalValue} />
        <StatCard icon="⏳" iconBg="#fff7ed" label={inProgressLabel} value={inProgressValue} />
      </StatGrid>

      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        <CitizenServiceLinks config={config} />

        <Card title={t("officerWorkspace")} padding>
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 0 }}>
            {t("workspaceBody", { label: config.label, resource: config.resourceLabel })}
          </p>
          <Link href={officerApplicationsHref(config.serviceKey)} className="btn ghost">
            {t("openResourceList", { resource: config.resourceLabel })}
          </Link>
        </Card>
      </div>
    </>
  );
}
