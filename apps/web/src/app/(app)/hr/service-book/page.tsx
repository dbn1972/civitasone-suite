/**
 * Service Book page — Sprint 14 / Lifecycle Phase 2
 * Paginated, filterable chronological service record using ServiceBookView.
 */
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { ServiceBookView, type ServiceEntry } from "./_components/ServiceBookView";
import { toHumanError } from "@/lib/messages";

async function getData(employeeId?: string): Promise<LoaderResult<ServiceEntry[]>> {
  const path = employeeId
    ? `/api/v1/hrms/service-book?employeeId=${encodeURIComponent(employeeId)}`
    : "/api/v1/hrms/service-book";
  return fetchJson<unknown, ServiceEntry[]>(path, [], {
    telemetryKey: "hr.service-book",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ServiceEntry[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ServiceBookPage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  const t = await getTranslations("serviceBook");
  // The employee profile's "Service Book" quick action links here with
  // ?empId= — previously ignored entirely, so it always showed every
  // employee's entries mixed together instead of the one the officer opened.
  const empId = searchParams?.empId;
  const { data: items, source } = await getData(empId);
  const errored = source === "error";

  const employees  = new Set(items.map((i) => i.employee ?? i.employeeId).filter(Boolean)).size;
  const transfers  = items.filter((i) =>
    i.eventType === "transfer" || i.eventType === "posting",
  ).length;
  const promotions = items.filter((i) =>
    i.eventType === "promotion" || i.eventType === "increment",
  ).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={empId ? t("titleForEmployee", { employee: items[0]?.employee ?? t("defaultEmployeeName") }) : t("title")}
        subtitle={empId ? t("subtitleForEmployee") : t("subtitleAll")}
        back="/hr" backLabel="Back to HR"
        actions={empId ? <Link href="/hr/service-book" className="btn ghost">{t("viewAllEmployeesLink")}</Link> : <span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📒" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalEntriesLabel")} value={errored ? null : items.length} />
        <StatCard icon="👥" iconBg="var(--bg, #f5f5f5)" label={t("statEmployeesLabel")} value={errored ? null : employees} />
        <StatCard icon="🔄" iconBg="var(--warnbg, #fffbe6)" label={t("statTransfersLabel")} value={errored ? null : transfers} />
        <StatCard icon="📈" iconBg="var(--goodbg, #e6f7f0)" label={t("statPromotionsLabel")} value={errored ? null : promotions} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "service book" })} backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <ServiceBookView entries={items} />
          </div>
        )}
      </Card>
    </main>
  );
}
