import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { todayIST } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { mapContracts, type ApiContract, type ApiStats } from "./outsourcedModel";
import { OutsourcedRegister } from "./OutsourcedRegister";

/**
 * GAP-HR-OUTSOURCED-01: the real vendor-supplied workforce register, served by
 * GET /v1/hrms/outsourced (hrms-service outsourced module). Mirrors that route's
 * own role gate (hr_admin / hr_officer / super_admin) -- contract values are
 * commercially sensitive, so this is HR-only, same as the backend.
 */
const OUTSOURCED_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const PAGE_SIZE = 50;

type Page = { rows: ApiContract[]; total: number; offset: number; stats: ApiStats };
const EMPTY_STATS: ApiStats = { contracts: 0, vendors: 0, activeContracts: 0, expiringIn60Days: 0, totalHeadcount: 0 };

export default async function OutsourcedPage({ searchParams }: { searchParams?: { offset?: string } }) {
  const roles = getSessionRoles();
  if (!roles.some((r) => OUTSOURCED_ROLES.includes(r))) {
    return <PermissionDenied module="the outsourced workforce register" requiredRoles={OUTSOURCED_ROLES} backHref="/hr" backLabel="Back to HR" />;
  }
  const t = await getTranslations("outsourced");
  const tc = await getTranslations("common");
  const requested = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const result = await fetchJson<unknown, Page>(
    `/api/v1/hrms/outsourced?limit=${PAGE_SIZE}&offset=${requested}`,
    { rows: [], total: 0, offset: requested, stats: EMPTY_STATS },
    {
      telemetryKey: "hr.outsourced",
      mapResponse: (p) => {
        const b = p as { data?: ApiContract[]; total?: number; stats?: ApiStats };
        if (!Array.isArray(b?.data)) return null;
        return { rows: b.data, total: b.total ?? b.data.length, offset: requested, stats: b.stats ?? EMPTY_STATS };
      },
    },
  );
  const { data: page, source } = result;
  const errored = source === "error";
  const items = mapContracts(page.rows, todayIST());
  const showingFrom = page.total > 0 ? page.offset + 1 : 0;
  const showingTo = page.offset + items.length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={tc("backToHr")} />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📄" iconBg="var(--infobg, #e6f0ff)" label={t("statContractsLabel")} value={errored ? "—" : page.stats.activeContracts} />
        <StatCard icon="🏢" iconBg="var(--bg, #f5f5f5)" label={t("statVendorsLabel")} value={errored ? "—" : page.stats.vendors} />
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statHeadcountLabel")} value={errored ? "—" : page.stats.totalHeadcount} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statExpiringLabel")} value={errored ? "—" : page.stats.expiringIn60Days} />
      </StatGrid>
      {errored ? (
        <Card title={t("cardTitle")}>
          <div className="pad">
            <LoadErrorState result={result} area="outsourced contracts" backHref="/hr" requiredRoles={OUTSOURCED_ROLES} />
          </div>
        </Card>
      ) : (
        <>
          {page.total > items.length ? (
            <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>
              {t("showingRange", { from: showingFrom, to: showingTo, total: page.total })}
            </p>
          ) : null}
          <OutsourcedRegister
            rows={items}
            canManage
            cardTitle={t("cardTitle")}
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
          {page.total > PAGE_SIZE ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              {page.offset > 0 ? (
                <Link href={`/hr/outsourced?offset=${Math.max(0, page.offset - PAGE_SIZE)}`} className="btn ghost">{t("prevPage")}</Link>
              ) : null}
              {page.offset + PAGE_SIZE < page.total ? (
                <Link href={`/hr/outsourced?offset=${page.offset + PAGE_SIZE}`} className="btn ghost">{t("nextPage")}</Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
