import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, Tabs, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PromotionBatchView } from "./_components/PromotionBatchView";
import { SeniorityListActions } from "./_components/SeniorityListActions";
import type { PromotionRow } from "../promotion/_components/PromotionCard";

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
  return fetchJson<unknown, DpcData>("/api/v1/hrms/dpc/eligibility", { asOf: "—", minQualifyingYears: 0, eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [] }, {
    telemetryKey: "hr.dpc",
    mapResponse: (p) => {
      const d = p as DpcData;
      return d && typeof d === "object" && Array.isArray(d.eligible) ? d : null;
    },
  });
}

async function getBatchPromotions(): Promise<LoaderResult<PromotionRow[]>> {
  const r = await fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/lifecycle/promotions", [], {
    telemetryKey: "hr.dpc.promotions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function DpcPage() {
  const t = await getTranslations("dpc");
  const roles = getSessionRoles();
  const canAdministerSeniority = roles.some((r) => SENIORITY_ADMIN_ROLES.includes(r));

  const [
    { data, source, status, errorMessage },
    { data: batchPromotions, source: promoSource, status: promoStatus, errorMessage: promoErrorMessage },
  ] = await Promise.all([getData(), getBatchPromotions()]);
  const errored = source === "error" || promoSource === "error";
  const errorResult =
    source === "error" ? { status, errorMessage } : { status: promoStatus, errorMessage: promoErrorMessage };
  const { asOf, eligibleCount, ineligibleCount, eligible, ineligible } = data ?? {
    asOf: "—", eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [],
  };
  const totalOfficers = (eligibleCount ?? 0) + (ineligibleCount ?? 0);

  const eligibleCols: { key: keyof EligibleRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "eligibilityRank",  label: t("colRank"),              align: "right" },
    { key: "fullName",         label: t("colOfficerName")                        },
    { key: "department",       label: t("colDepartment")                          },
    { key: "designation",      label: t("colDesignation")                         },
    { key: "grade",            label: t("colPayGrade")                           },
    { key: "qualifyingYears",  label: t("colQualifyingService"), align: "right" },
    { key: "dateOfJoining",    label: t("colDateOfJoining")                     },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { asOf })}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <SeniorityListActions canAdminister={canAdministerSeniority} />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statEligible")}       value={errored ? null : eligibleCount} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statNotYetEligible")} value={errored ? null : ineligibleCount} />
        <StatCard icon="📅" iconBg="var(--bg, #f5f5f5)" label={t("statAsOnDate")}       value={errored ? null : asOf} />
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statTotalOfficers")}  value={errored ? null : totalOfficers} />
      </StatGrid>

      {/* Eligible Officers seniority list */}
      <Card title={t("eligibleListTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={errorResult} area="dpc" backHref="/hr" />
          </div>
        ) : (
          <DataTable<EligibleRow>
          columns={eligibleCols}
          rows={eligible}
          sortable filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyIcon="📋"
          emptyTitle={t("noEligibleTitle")}
          emptyMessage={t("noEligibleMessage")}
        />
        )}
      </Card>

      {/* DPC Batch Promotion View */}
      <Card title={t("batchPromotionsTitle")}>
        <div className="pad">
          <PromotionBatchView promotions={batchPromotions} />
        </div>
      </Card>

      {ineligible.length > 0 && (
        <div className="mt-4"><Card>
          <DataTable<EligibleRow>
            columns={[
              { key: "fullName",        label: t("colOfficerName")           },
              { key: "department",      label: t("colDepartment")             },
              { key: "grade",           label: t("colPayGrade")              },
              { key: "qualifyingYears", label: t("colServiceYears"), align: "right" },
            ]}
            rows={ineligible}
            sortable pageSize={10}
            emptyIcon="⏳"
            emptyTitle={t("allEligibleTitle")}
            emptyMessage=""
          />
        </Card></div>
      )}
    </div>
  );
}
