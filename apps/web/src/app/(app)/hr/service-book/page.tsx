/**
 * Service Book page — Sprint 14 / Lifecycle Phase 2
 * Paginated, filterable chronological service record using ServiceBookView.
 */
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, Field, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SERVICE_BOOK_TRANSFER_TYPES, SERVICE_BOOK_PROMOTION_TYPES } from "@/lib/serviceBookEventTypes";
import { ServiceBookView, type ServiceEntry } from "./_components/ServiceBookView";
import { ServiceBookEmployeePicker } from "./_components/ServiceBookEmployeePicker";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";

const HR_ROLES = HR_STAFF_ROLES;

type ServiceBookPayload = {
  items: ServiceEntry[];
  total: number;
  hasMore: boolean;
  /** Distinct employees with an entry in scope -- a full-scope aggregate, not a count of the loaded page. */
  employeesTotal: number;
  transfersTotal: number;
  promotionsTotal: number;
};

function emptyPayload(): ServiceBookPayload {
  return { items: [], total: 0, hasMore: false, employeesTotal: 0, transfersTotal: 0, promotionsTotal: 0 };
}

/**
 * GAP-HR-SERVICE-BOOK-04: server-side paging. The API returns the newest entries first, so page 1 (no
 * limit/offset) is the latest SERVICE_BOOK_PAGE_SIZE entries and "Older entries" walks back in time.
 * Matches the API's own default and maximum `limit`.
 */
const SERVICE_BOOK_PAGE_SIZE = 1000;

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

async function getData(employeeId: string | undefined, page: number): Promise<LoaderResult<ServiceBookPayload>> {
  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", employeeId);
  if (page > 1) {
    params.set("limit", String(SERVICE_BOOK_PAGE_SIZE));
    params.set("offset", String((page - 1) * SERVICE_BOOK_PAGE_SIZE));
  }
  const qs = params.toString();
  const path = qs ? `/api/v1/hrms/service-book?${qs}` : "/api/v1/hrms/service-book";
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
        employeesTotal: meta?.employeesTotal ?? new Set(arr.map((e) => e.employeeId).filter(Boolean)).size,
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
      return { items: arr, total: arr.length, hasMore: false, employeesTotal: arr.length > 0 ? 1 : 0, transfersTotal, promotionsTotal };
    },
  });
}

export default async function ServiceBookPage(
  props: {
    searchParams?: Promise<{ empId?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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
  const page = isHr ? parsePage(searchParams?.page) : 1;
  const { data, source, status, errorMessage } = isHr ? await getData(empId, page) : await getMyData();
  const errored = source === "error";
  const { items, total, hasMore, employeesTotal, transfersTotal, promotionsTotal } = data;

  // Prev/next links for the server pages, keeping the employee scope; page 1 has no ?page= at all.
  const pageHref = (target: number): string => {
    const params = new URLSearchParams();
    if (empId) params.set("empId", empId);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/hr/service-book?${qs}` : "/hr/service-book";
  };

  const title = isHr
    ? (empId ? t("titleForEmployee", { employee: items[0]?.employee ?? t("defaultEmployeeName") }) : t("title"))
    : t("titleMine");
  const subtitle = isHr ? (empId ? t("subtitleForEmployee") : t("subtitleAll")) : t("subtitleMine");

  return (
    <div className="page-main wrap">
      <PageHeader
        title={title}
        subtitle={subtitle}
        back="/hr" backLabel={t("backLabel")}
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
        <StatCard icon="📒" iconBg="var(--infobg)" label={t("statTotalEntriesLabel")} value={errored ? null : total} />
        {isHr && (
          <StatCard icon="👥" iconBg="var(--bg)" label={t("statEmployeesLabel")} value={errored ? null : employeesTotal} />
        )}
        <StatCard icon="🔄" iconBg="var(--warnbg)" label={t("statTransfersLabel")} value={errored ? null : transfersTotal} />
        <StatCard icon="📈" iconBg="var(--goodbg)" label={t("statPromotionsLabel")} value={errored ? null : promotionsTotal} />
      </StatGrid>

      {/* GAP-HR-SERVICE-BOOK-04: employee search-select (replaces the free-text filter): re-scopes the whole page via ?empId=. */}
      {isHr && (
        <div style={{ margin: "0 0 14px", maxWidth: 420 }}>
          <Field label={t("employeePickerLabel")}>
            <ServiceBookEmployeePicker selectedId={empId} selectedLabel={empId ? items[0]?.employee : undefined} />
          </Field>
        </div>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="service book" backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <ServiceBookView entries={items} />
            {isHr && (hasMore || page > 1) && (
              <>
                <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 12 }}>
                  {t("truncationNotice", { shown: items.length, total })}
                </p>
                {/* Server pagination, newest first: older entries are one page further back. */}
                <nav aria-label={t("pagerAriaLabel")} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  {page > 1 && <Link href={pageHref(page - 1)} className="btn ghost">{t("newerEntriesLink")}</Link>}
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("pageLabel", { page })}</span>
                  {hasMore && <Link href={pageHref(page + 1)} className="btn ghost">{t("olderEntriesLink")}</Link>}
                </nav>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
