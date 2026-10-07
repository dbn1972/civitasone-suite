/**
 * Service Book page — Sprint 14 / Lifecycle Phase 2
 * Paginated, filterable chronological service record using ServiceBookView.
 */
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SERVICE_BOOK_TRANSFER_TYPES, SERVICE_BOOK_PROMOTION_TYPES } from "@/lib/serviceBookEventTypes";
import { ServiceBookView, type ServiceEntry } from "./_components/ServiceBookView";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type ServiceBookPayload = {
  items: ServiceEntry[];
  total: number;
  hasMore: boolean;
  transfersTotal: number;
  promotionsTotal: number;
};

function emptyPayload(): ServiceBookPayload {
  return { items: [], total: 0, hasMore: false, transfersTotal: 0, promotionsTotal: 0 };
}

async function getData(employeeId?: string): Promise<LoaderResult<ServiceBookPayload>> {
  const path = employeeId
    ? `/api/v1/hrms/service-book?employeeId=${encodeURIComponent(employeeId)}`
    : "/api/v1/hrms/service-book";
  return fetchJson<unknown, ServiceBookPayload>(path, emptyPayload(), {
    telemetryKey: "hr.service-book",
    mapResponse: (p) => {
      const payload = p as { data?: ServiceEntry[]; meta?: Record<string, number> } | ServiceEntry[];
      const arr = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(arr)) return null;
      const meta = Array.isArray(payload) ? undefined : payload?.meta;
      return {
        items: arr,
        total: meta?.total ?? arr.length,
        hasMore: Boolean(meta?.hasMore),
        transfersTotal: meta?.transfersTotal ?? 0,
        promotionsTotal: meta?.promotionsTotal ?? 0,
      };
    },
  });
}

// GAP-HR-SERVICE-BOOK-06: the caller's own record via the new
// GET /v1/hrms/service-book/me (see routes.ts) -- this endpoint has no
// meta/pagination envelope (it is always scoped to one employee, so
// truncation at 1000 lifetime entries is not a realistic concern), just
// { data: ServiceEntry[] }.
async function getMyData(): Promise<LoaderResult<ServiceBookPayload>> {
  return fetchJson<unknown, ServiceBookPayload>("/api/v1/hrms/service-book/me", emptyPayload(), {
    telemetryKey: "hr.service-book.me",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ServiceEntry[] })?.data;
      if (!Array.isArray(arr)) return null;
      const transfersTotal = arr.filter((e) => (SERVICE_BOOK_TRANSFER_TYPES as readonly string[]).includes(e.eventType)).length;
      const promotionsTotal = arr.filter((e) => (SERVICE_BOOK_PROMOTION_TYPES as readonly string[]).includes(e.eventType)).length;
      return { items: arr, total: arr.length, hasMore: false, transfersTotal, promotionsTotal };
    },
  });
}

export default async function ServiceBookPage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  const t = await getTranslations("serviceBook");
  const roles = getSessionRoles();
  const isHr = HR_ROLES.some((r) => roles.includes(r));
  // The employee profile's "Service Book" quick action links here with
  // ?empId= — previously ignored entirely, so it always showed every
  // employee's entries mixed together instead of the one the officer opened.
  const empId = searchParams?.empId;
  // GAP-HR-SERVICE-BOOK-06: a plain employee/manager without an HR role
  // previously hit the tenant-wide, HR-only endpoint and got a permission
  // error for what is supposed to be their OWN record. They now get their
  // own service book via the self-service endpoint instead; ?empId is an
  // HR-only navigation affordance (from the employee profile page) and is
  // ignored for a self-service caller.
  const { data, source, status, errorMessage } = isHr ? await getData(empId) : await getMyData();
  const errored = source === "error";
  const { items, total, hasMore, transfersTotal, promotionsTotal } = data;

  const employeesCount = new Set(items.map((i) => i.employee ?? i.employeeId).filter(Boolean)).size;

  const title = isHr
    ? (empId ? t("titleForEmployee", { employee: items[0]?.employee ?? t("defaultEmployeeName") }) : t("title"))
    : t("titleMine");
  const subtitle = isHr ? (empId ? t("subtitleForEmployee") : t("subtitleAll")) : t("subtitleMine");

  return (
    <div className="page-main wrap">
      <PageHeader
        title={title}
        subtitle={subtitle}
        back="/hr" backLabel="Back to HR"
        actions={
          isHr && empId ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/hr/service-book" className="btn ghost">{t("viewAllEmployeesLink")}</Link>
              {/* GAP-HR-SERVICE-BOOK-01: this opens a printable HTML page in a
                  new tab (browser Print → Save as PDF), not a literal PDF
                  download -- worded honestly rather than "Download PDF". */}
              <a href={`/api/proxy/v1/hrms/employees/${encodeURIComponent(empId)}/service-book/pdf`}
                 target="_blank" rel="noreferrer" className="btn ghost">
                {t("printServiceBookLink")}
              </a>
            </div>
          ) : <span />
        }
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📒" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalEntriesLabel")} value={errored ? null : total} />
        {isHr && (
          <StatCard icon="👥" iconBg="var(--bg, #f5f5f5)" label={t("statEmployeesLabel")} value={errored ? null : employeesCount} />
        )}
        <StatCard icon="🔄" iconBg="var(--warnbg, #fffbe6)" label={t("statTransfersLabel")} value={errored ? null : transfersTotal} />
        <StatCard icon="📈" iconBg="var(--goodbg, #e6f7f0)" label={t("statPromotionsLabel")} value={errored ? null : promotionsTotal} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="service book" backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <ServiceBookView entries={items} hideEmployeeFilter={!isHr} />
            {isHr && hasMore && (
              <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 12 }}>
                {t("truncationNotice", { shown: items.length, total })}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
