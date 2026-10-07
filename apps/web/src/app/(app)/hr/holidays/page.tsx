import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddHolidayForm } from "./AddHolidayForm";
import { HolidaysTableClient } from "./HolidaysTableClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";

type ApiHoliday = {
  id: string;
  date: string;
  day?: string;
  name: string;
  type: string;
  applicableTo?: string;
};

export type Row = {
  id: string;
  date: string;
  day: string;
  name: string;
  type: string;
  applicableTo: string;
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

function mapHolidays(apiHolidays: ApiHoliday[]): Row[] {
  return apiHolidays.map((h) => ({
    id: h.id,
    date: h.date,
    day: h.day ?? getDayName(h.date),
    name: h.name,
    // GAP-HR-HOLIDAYS-04: render the raw API code through an i18n label map
    // in the client table (typed union, unknown codes fall back to the raw
    // string) rather than printing "gazetted"/"all" verbatim.
    type: h.type ?? "gazetted",
    applicableTo: h.applicableTo ?? "all",
  }));
}

async function getHolidays(year: number): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>(`/api/v1/hrms/holidays?year=${year}`, [], {
    telemetryKey: "hr.holidays",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiHoliday[] })?.data;
      return Array.isArray(arr) ? mapHolidays(arr as ApiHoliday[]) : null;
    },
  });
}

/**
 * Mirrors holidays/routes.ts: POST/DELETE require
 * HR_ROLES = ["hr_admin", "super_admin", "admin"].
 */
const HOLIDAY_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

export default async function HolidaysPage({ searchParams }: { searchParams?: { year?: string } }) {
  const t = await getTranslations("holidays");
  const currentYear = new Date().getFullYear();
  // GAP-HR-HOLIDAYS-02: the backend already accepts ?year= (defaulting to
  // the current year) -- nothing on this page ever sent it, so next
  // year's gazetted list (usually notified in December) was unreachable.
  const yearParam = searchParams?.year;
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const { data: items, source } = await getHolidays(year);
  const errored = source === "error";
  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => HOLIDAY_ADMIN_ROLES.includes(r));

  const gazetted = items.filter((i) => i.type === "gazetted").length;
  const restricted = items.filter((i) => i.type === "restricted").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📅" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="🏛️" iconBg="var(--goodbg, #e6f7f0)" label={t("statGazetted")} value={errored ? null : gazetted} />
        <StatCard icon="📋" iconBg="var(--warnbg, #fffbe6)" label={t("statRestricted")} value={errored ? null : restricted} />
        <StatCard icon="🗓️" iconBg="var(--bg, #f5f5f5)" label={t("statYear")} value={year} />
      </StatGrid>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Link href={`/hr/holidays?year=${year - 1}`} className="btn" aria-label={t("prevYear", { year: year - 1 })}>
          ← {year - 1}
        </Link>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{year}</span>
        <Link href={`/hr/holidays?year=${year + 1}`} className="btn" aria-label={t("nextYear", { year: year + 1 })}>
          {year + 1} →
        </Link>
      </div>

      {/* Add-holiday form: visible only to admin roles (mirrors backend POST gate) */}
      {canManage && <AddHolidayForm year={year} />}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "holidays" })} backHref="/hr" />
          </div>
        ) : (
          <>
            <div className="card-h"><h3>{t("listTitle", { year })}</h3></div>
            <HolidaysTableClient rows={items} canManage={canManage} />
          </>
        )}
      </Card>
    </div>
  );
}
