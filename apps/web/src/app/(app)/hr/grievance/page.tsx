import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { EMPTY_COUNTS, GRIEVANCE_ROLES, PAGE_SIZE, type GrievanceCounts } from "./grievanceModel";

/**
 * GAP-HR-GRIEVANCE-01/02/03/06: the register is real now (hrms-service
 * modules/grievance). The list carries COARSE columns only -- the free-text
 * subject/description is detail-only (DPDP). Stat cards come from the
 * server's whole-register counts (not the current page), and Open + Under
 * Inquiry + Disposed always equals Total.
 */
type RawRow = {
  id: string;
  caseNo: string;
  employee: string;
  department: string | null;
  category: string;
  filedDate: string;
  assignedToName: string | null;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { categoryLabel: string; officer: string };

type ListPage = { items: RawRow[]; total: number; counts: GrievanceCounts };

async function getData(offset: number): Promise<LoaderResult<ListPage>> {
  return fetchJson<unknown, ListPage>(
    `/api/v1/hrms/grievances?limit=${PAGE_SIZE}&offset=${offset}`,
    { items: [], total: 0, counts: EMPTY_COUNTS },
    {
      telemetryKey: "hr.grievances",
      mapResponse: (p) => {
        const body = p as { data?: RawRow[]; meta?: { total?: number; counts?: GrievanceCounts } } | null;
        if (!body || !Array.isArray(body.data)) return null;
        return {
          items: body.data,
          total: body.meta?.total ?? body.data.length,
          counts: body.meta?.counts ?? EMPTY_COUNTS,
        };
      },
    },
  );
}

export default async function GrievancePage({ searchParams }: { searchParams?: { page?: string } }) {
  const t = await getTranslations("grievance");

  // GAP-HR-GRIEVANCE-04/05: role gate before any fetch (defense in depth
  // alongside the server's own check).
  const roles = getSessionRoles();
  if (!roles.some((r: string) => GRIEVANCE_ROLES.includes(r))) {
    return <PermissionDenied module="grievances" requiredRoles={GRIEVANCE_ROLES} />;
  }

  const page = Math.max(1, Math.trunc(Number(searchParams?.page)) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const result = await getData(offset);
  const { data, source } = result;
  const errored = source === "error";
  const hasMore = offset + data.items.length < data.total;

  const items: Row[] = data.items.map((r) => ({
    ...r,
    categoryLabel: t(`category_${r.category}` as never),
    officer: r.assignedToName ?? t("unassigned"),
  }));

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "caseNo", label: t("colRefNo") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "categoryLabel", label: t("colGrievance") },
    { key: "filedDate", label: t("colFiledDate"), cellType: "date" },
    { key: "officer", label: t("colHrOfficer") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // A dash (not a real "0") whenever the fetch failed: 0 claims "we checked".
  const statValue = (n: number) => (errored ? null : n);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<Link href="/hr/grievance/new" className="btn">{t("registerButton")}</Link>}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCasesLabel")} value={statValue(data.counts.total)} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statOpenLabel")} value={statValue(data.counts.open)} />
        <StatCard icon="🔍" iconBg="var(--warnbg, #fffbe6)" label={t("statUnderInquiryLabel")} value={statValue(data.counts.underInquiry)} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedLabel")} value={statValue(data.counts.disposed)} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="grievances" backHref="/hr" requiredRoles={GRIEVANCE_ROLES} />
          </div>
        ) : (
          <>
            <DataTable<Row>
              columns={columns}
              rows={items}
              rowLinkKey="id"
              rowLinkPrefix="/hr/grievance/"
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="📋"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            {(page > 1 || hasMore) && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                {page > 1 ? <Link href={`/hr/grievance?page=${page - 1}`} className="btn-outline">← {t("prevBatch")}</Link> : <span />}
                {hasMore ? <Link href={`/hr/grievance?page=${page + 1}`} className="btn-outline">{t("nextBatch")} →</Link> : <span />}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
