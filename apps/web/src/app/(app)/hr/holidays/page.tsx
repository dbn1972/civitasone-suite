import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddHolidayForm } from "./AddHolidayForm";

type ApiHoliday = {
  id: string;
  date: string;
  day?: string;
  name: string;
  type: string;
  applicableTo?: string;
  status?: string;
};

type Row = {
  id: string;
  date: string;
  day: string;
  name: string;
  type: string;
  applicableTo: string;
  status: string;
} & Record<string, unknown>;

function getDayName(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { weekday: "long" });
  } catch {
    return "—";
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function mapHolidays(apiHolidays: ApiHoliday[]): Row[] {
  return apiHolidays.map((h) => ({
    id: h.id,
    date: formatDate(h.date),
    day: h.day ?? getDayName(h.date),
    name: h.name,
    type: h.type ?? "Gazetted",
    applicableTo: h.applicableTo ?? "All",
    status: h.status ?? "active",
  }));
}

async function getHolidays(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/holidays", [], {
    telemetryKey: "hr.holidays",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiHoliday[] })?.data;
      return Array.isArray(arr) ? mapHolidays(arr as ApiHoliday[]) : null;
    },
  });
  return res;
}

const CURRENT_YEAR = new Date().getFullYear();

export default async function HolidaysPage() {
  const t = await getTranslations("holidays");
  const { data: items, source } = await getHolidays();

  const gazetted = items.filter((i) => i.type === "gazetted" || i.type === "Gazetted").length;
  const restricted = items.filter((i) => i.type === "restricted" || i.type === "Restricted").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "date", label: t("colDate") },
    { key: "day", label: t("colDay") },
    { key: "name", label: t("colHoliday") },
    { key: "type", label: t("colType") },
    { key: "applicableTo", label: t("colApplicableTo") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f0ff" label={t("statTotal")} value={items.length} />
        <StatCard icon="🏛️" iconBg="#e6f7f0" label={t("statGazetted")} value={gazetted} />
        <StatCard icon="📋" iconBg="#fffbe6" label={t("statRestricted")} value={restricted} />
        <StatCard icon="🗓️" iconBg="#f5f5f5" label={t("statYear")} value={CURRENT_YEAR} />
      </StatGrid>

      <AddHolidayForm />

      <Card title={t("cardTitle")}>
        <div className="card-h"><h3>{t("listTitle", { year: CURRENT_YEAR })}</h3></div>
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📅"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}
