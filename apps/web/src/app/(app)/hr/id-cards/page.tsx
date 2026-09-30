import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { IdCardsTable, type IdCardRow } from "./IdCardsTable";

// Matches the backend role gate on GET /v1/hrms/id-cards (services/hrms-service/
// src/modules/id-cards/routes.ts) -- this page had no client-side gate at all,
// so any authenticated user could reach a UI showing org-wide holder photo,
// card number, department, and access_zones even though the backend now
// (separately) rejects the underlying fetch for anyone outside this list.
//
// GAP-HR-ID-CARDS-06: hr_officer administers most of /hr but is deliberately
// excluded here too -- per the published decision packet's default
// ("leave all four hr_admin-tier for now — each is either security-sensitive
// or high-blast-radius"), this stays as-is; the fix is honest messaging
// (below) instead of a silent dead end, not widening the gate.
const ID_CARDS_ROLES = ["hr_admin", "security_admin", "super_admin"];

const PAGE_SIZE = 100;

type ListMeta = { statusCounts?: Record<string, number>; vendorProjectTotal?: number };
type IdCardsData = { items: IdCardRow[]; total: number; meta: ListMeta };

async function getData(q: string | undefined, status: string | undefined, offset: number): Promise<LoaderResult<IdCardsData>> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q) params.set("search", q);
  if (status) params.set("status", status);
  return fetchJson<unknown, IdCardsData>(`/api/v1/hrms/id-cards?${params.toString()}`, { items: [], total: 0, meta: {} }, {
    telemetryKey: "hr.id-cards",
    mapResponse: (p) => {
      const body = p as { data?: IdCardRow[]; total?: number; meta?: ListMeta };
      if (!Array.isArray(body?.data)) return null;
      return { items: body.data, total: body.total ?? body.data.length, meta: body.meta ?? {} };
    },
  });
}

const STATUS_OPTIONS = ["", "active", "suspended", "revoked", "expired"] as const;

export default async function IdCardsPage({ searchParams }: { searchParams?: Record<string, string> }) {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ID_CARDS_ROLES.includes(r));
  if (!canAccess) {
    return (
      <PermissionDenied
        module="ID cards"
        requiredRoles={ID_CARDS_ROLES}
        // GAP-HR-ID-CARDS-06: explains WHY, rather than a bare role list --
        // this register includes physical access-zone data, hence the
        // narrower (security_admin-inclusive, hr_officer-excluded) gate
        // than the rest of /hr.
        reason="ID cards include physical access-zone data, so this register is restricted to HR admins and security admins."
        backHref="/hr"
        backLabel="Back to HR"
      />
    );
  }

  const t = await getTranslations("idCards");
  const q = searchParams?.q?.trim() || undefined;
  const status = searchParams?.status || undefined;
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const loaderResult = await getData(q, status, offset);
  const { data, source } = loaderResult;
  const errored = source === "error";
  const { items, total, meta } = data;
  const statusCounts = meta.statusCounts ?? {};
  const active = statusCounts.active ?? 0;
  const suspended = statusCounts.suspended ?? 0;
  const vendor = meta.vendorProjectTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={
          // GAP-HR-ID-CARDS-01: the subtitle has always promised "Issue,
          // manage, and verify" -- this is the first of the three the page
          // itself now actually offers (manage = IdCardActions below).
          <Link href="/hr/id-cards/new" className="btn primary">
            Issue ID card
          </Link>
        }
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🆔" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCardsLabel")} value={errored ? "—" : total} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? "—" : active} />
        <StatCard icon="⏸️" iconBg="var(--warnbg, #fffbe6)" label={t("statSuspendedLabel")} value={errored ? "—" : suspended} />
        <StatCard icon="👥" iconBg="var(--bg, #f5f5f5)" label={t("statVendorProjectLabel")} value={errored ? "—" : vendor} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {/* GAP-HR-ID-CARDS-05: search/status reach the whole tenant register
            (server-side, a plain GET form -- no client JS needed) instead of
            silently capping at the first page's rows. */}
        <form
          method="get"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}
        >
          <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="sr-only">{t("filterPlaceholder")}</span>
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder={t("filterPlaceholder")}
              aria-label={t("filterPlaceholder")}
              style={{ minHeight: 44, borderRadius: 6, border: "1.5px solid var(--line, #e2e8f0)", padding: "8px 12px", fontSize: 13 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="sr-only">Status</span>
            <select
              name="status"
              defaultValue={status ?? ""}
              aria-label="Filter by status"
              style={{ minHeight: 44, borderRadius: 6, border: "1.5px solid var(--line, #e2e8f0)", padding: "8px 12px", fontSize: 13 }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : "All statuses"}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>Search</button>
          {(q || status) && (
            <Link href="/hr/id-cards" className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              Clear
            </Link>
          )}
        </form>

        {errored ? (
          <LoadErrorState result={loaderResult} area="ID cards" backHref="/hr" backLabel="Back to HR" module="ID cards" requiredRoles={ID_CARDS_ROLES} />
        ) : (
          <>
            <IdCardsTable rows={items} />
            {totalPages > 1 && (
              <nav aria-label="ID cards pagination" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
                {page > 1 && (
                  <Link href={`/hr/id-cards?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(page - 1) }).toString()}`} className="btn ghost">
                    ← Previous
                  </Link>
                )}
                <span style={{ alignSelf: "center", fontSize: 13, color: "var(--muted)" }}>
                  Page {page} of {totalPages} ({total} total)
                </span>
                {page < totalPages && (
                  <Link href={`/hr/id-cards?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(page + 1) }).toString()}`} className="btn ghost">
                    Next →
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
