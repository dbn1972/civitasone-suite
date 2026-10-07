import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PromotionBatchView } from "./_components/PromotionBatchView";
import { SeniorityListActions, type SeniorityListSummary } from "./_components/SeniorityListActions";
import type { PromotionRow } from "../promotion/_components/PromotionCard";
import { formatIndianDate } from "@/lib/formatters";

// DOM-023: mirrors the backend's HR_ROLES guard exactly
// (services/hrms-service/src/modules/seniority/routes.ts) for the
// generate/approve write actions -- the broader read-only "manager" role
// that can see the live GET views above is intentionally excluded.
const SENIORITY_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type EligibleRow = {
  employeeId: string;
  fullName: string;
  department?: string;
  designation?: string;
  grade?: string;
  dateOfJoining?: string;
  yearsOfService?: number;
  qualifyingYears: number;
  eligibilityRank: number;
} & Record<string, unknown>;

type DpcData = {
  asOf: string;
  minQualifyingYears: number;
  eligibleCount: number;
  ineligibleCount: number;
  eligible: EligibleRow[];
  ineligible: EligibleRow[];
};

async function getData() {
  return fetchJson<unknown, DpcData>("/api/v1/hrms/dpc/eligibility", { asOf: "—", minQualifyingYears: 5, eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [] }, {
    telemetryKey: "hr.dpc",
    mapResponse: (p) => {
      const d = p as DpcData;
      return d && typeof d === "object" && Array.isArray(d.eligible) ? d : null;
    },
  });
}

async function getBatchPromotions(): Promise<LoaderResult<PromotionRow[]>> {
  // GAP-HR-DPC-02: exclude promotions that are already fully resolved
  // (signed/completed) or cancelled -- there is no real DPC-batch linkage
  // in the schema to scope this to "this DPC's batch" precisely (see that
  // GAP's own note), but restricting to still-in-flight statuses is a
  // meaningfully closer approximation than every promotion the tenant has
  // ever made.
  const r = await fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/lifecycle/promotions?status=pending", [], {
    telemetryKey: "hr.dpc.promotions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

async function getSeniorityLists(): Promise<LoaderResult<SeniorityListSummary[]>> {
  return fetchJson<unknown, SeniorityListSummary[]>("/api/v1/hrms/seniority/lists", [], {
    telemetryKey: "hr.dpc.seniorityLists",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: SeniorityListSummary[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DpcPage() {
  const t = await getTranslations("dpc");
  const roles = getSessionRoles();
  const canAdministerSeniority = roles.some((r) => SENIORITY_ADMIN_ROLES.includes(r));

  // GAP-HR-DPC-03: the promotions fetch (HR_ROLES-only on the backend) is
  // now only attempted for a caller who can actually administer seniority —
  // a plain "manager" viewing the eligibility list no longer triggers a
  // guaranteed-403 request purely to populate a card they can't act on
  // anyway. GAP-HR-DPC-04's seniority-lists fetch is HR_ROLES-only for the
  // same reason.
  const [
    { data, source, status, errorMessage },
    promoResult,
    listsResult,
  ] = await Promise.all([
    getData(),
    canAdministerSeniority
      ? getBatchPromotions()
      : Promise.resolve<LoaderResult<PromotionRow[]>>({ data: [], source: "api" }),
    canAdministerSeniority
      ? getSeniorityLists()
      : Promise.resolve<LoaderResult<SeniorityListSummary[]>>({ data: [], source: "api" }),
  ]);
  const { data: batchPromotions, source: promoSource, status: promoStatus, errorMessage: promoErrorMessage } = promoResult;

  // GAP-HR-DPC-03: separate flags -- a manager whose OWN eligibility fetch
  // succeeded must still see the stats and eligible-officers table; only
  // the (HR-only, now conditionally-fetched) batch-promotions card is
  // affected by promoErrored.
  const eligibilityErrored = source === "error";
  const promoErrored = promoSource === "error";
  const { asOf, minQualifyingYears, eligibleCount, ineligibleCount, eligible, ineligible } = data ?? {
    asOf: "—", minQualifyingYears: 5, eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [],
  };
  const totalOfficers = (eligibleCount ?? 0) + (ineligibleCount ?? 0);

  // GAP-HR-DPC-05: dateOfJoining now uses DataTable's existing "date"
  // cellType (it already exists — see ds/DataTable.tsx — this page just
  // never opted a column into it) and qualifyingYears is pre-formatted
  // into its own display field server-side (a Server Component page can't
  // hand DataTable a `render:` function — see that file's Column<T> doc
  // comment for the exact crash class this avoids).
  const eligibleRows = eligible.map((r) => ({
    ...r,
    qualifyingYearsLabel: t("qualifyingYearsValue", { years: r.qualifyingYears.toFixed(1) }),
  }));
  const ineligibleRows = ineligible.map((r) => ({
    ...r,
    qualifyingYearsLabel: t("qualifyingYearsValue", { years: r.qualifyingYears.toFixed(1) }),
  }));

  const eligibleCols = [
    { key: "eligibilityRank" as const,      label: t("colRank"),              align: "right" as const },
    { key: "fullName" as const,             label: t("colOfficerName")                        },
    { key: "department" as const,           label: t("colDepartment")                          },
    { key: "designation" as const,          label: t("colDesignation")                         },
    { key: "grade" as const,                label: t("colPayGrade")                           },
    { key: "qualifyingYearsLabel" as const, label: t("colQualifyingService"), align: "right" as const },
    { key: "dateOfJoining" as const,        label: t("colDateOfJoining"), cellType: "date" as const },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { asOf: formatIndianDate(asOf), years: minQualifyingYears })}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {canAdministerSeniority && (
        <SeniorityListActions canAdminister={canAdministerSeniority} lists={listsResult.data} />
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statEligible")}       value={eligibilityErrored ? null : eligibleCount} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statNotYetEligible")} value={eligibilityErrored ? null : ineligibleCount} />
        <StatCard icon="📅" iconBg="var(--bg, #f5f5f5)" label={t("statAsOnDate")}       value={eligibilityErrored ? null : formatIndianDate(asOf)} />
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statTotalOfficers")}  value={eligibilityErrored ? null : totalOfficers} />
      </StatGrid>

      {/* Eligible Officers seniority list */}
      <Card title={t("eligibleListTitle")}>
        {eligibilityErrored ? (
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="dpc" backHref="/hr" />
          </div>
        ) : (
          <DataTable<(typeof eligibleRows)[number]>
          columns={eligibleCols}
          rows={eligibleRows}
          sortable filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyIcon="📋"
          emptyTitle={t("noEligibleTitle")}
          emptyMessage={t("noEligibleMessage")}
        />
        )}
      </Card>

      {/* DPC Batch Promotion View — HR/admin only (GAP-HR-DPC-03) */}
      {canAdministerSeniority && (
        <Card title={t("batchPromotionsTitle")}>
          <div className="pad">
            {promoErrored ? (
              <LoadErrorState result={{ status: promoStatus, errorMessage: promoErrorMessage }} area="dpc" backHref="/hr" />
            ) : (
              <PromotionBatchView promotions={batchPromotions} />
            )}
          </div>
        </Card>
      )}

      {/* GAP-HR-DPC-06: always rendered when the eligibility fetch itself
          succeeded (previously gated behind `ineligible.length > 0`, which
          made the DataTable's own "all eligible" empty state unreachable
          dead code) -- now has a title and is filterable, matching the
          eligible table above. */}
      {!eligibilityErrored && (
        <div className="mt-4"><Card title={t("notYetEligibleTitle")}>
          <DataTable<(typeof ineligibleRows)[number]>
            columns={[
              { key: "fullName" as const,             label: t("colOfficerName")           },
              { key: "department" as const,           label: t("colDepartment")             },
              { key: "grade" as const,                label: t("colPayGrade")              },
              { key: "qualifyingYearsLabel" as const, label: t("colServiceYears"), align: "right" as const },
            ]}
            rows={ineligibleRows}
            sortable filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={10}
            emptyIcon="⏳"
            emptyTitle={t("allEligibleTitle")}
            emptyMessage={t("allEligibleMessage")}
          />
        </Card></div>
      )}
    </div>
  );
}
