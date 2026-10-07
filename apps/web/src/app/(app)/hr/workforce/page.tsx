import Link from "next/link";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import {
  getHeadcount,
  getRetirements,
  getVacancyForecast,
  getRetirementAgeMeta,
  sumRetiringWithinMonths,
  VACANCY_HORIZON_ORDER,
  type GroupBy,
  type HeadcountRow,
  type RetirementRow,
  type VacancyRow,
} from "./_data";

const GROUP_BY_VALUES = ["department", "grade", "type"] as const;
const groupBySchema = z.enum(GROUP_BY_VALUES).catch("department");

/** GAP-HR-WORKFORCE-06: falls back to "department" for anything invalid (zod's `.catch`) instead of 500ing on `?groupBy=foo`. */
function parseGroupBy(raw: string | string[] | undefined): GroupBy {
  return groupBySchema.parse(Array.isArray(raw) ? raw[0] : raw);
}

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: { groupBy?: string | string[] };
}) {
  const t = await getTranslations("workforce");
  const groupBy = parseGroupBy(searchParams.groupBy);

  const [hc, rt, vf, retirementAge] = await Promise.all([
    getHeadcount(groupBy),
    getRetirements(1),
    getVacancyForecast(),
    getRetirementAgeMeta(),
  ]);

  const headcount = hc.data;
  const retirements = rt.data;
  const vacancies = vf.data;

  const hcErrored = hc.source === "error";
  const rtErrored = rt.source === "error";
  const vfErrored = vf.source === "error";
  // GAP-HR-WORKFORCE-02: kept only for the small top-of-page badge (matching
  // this codebase's existing multi-loader convention, e.g. ai/chat/[id]) --
  // every actual content region below decides its OWN render path from its
  // OWN loader's source, so one failing endpoint never blanks another card.
  const badgeSource = hcErrored || rtErrored || vfErrored ? "error" : "api";

  const totalHeadcount = headcount.reduce((s, r) => s + Number(r.count), 0);
  const retiringSoon = sumRetiringWithinMonths(retirements, 6);
  const retiring12 = sumRetiringWithinMonths(retirements, 12);

  const groupColLabel =
    groupBy === "grade" ? t("colGrade") : groupBy === "type" ? t("colEmployeeType") : t("colDepartment");
  const groupByChoiceLabel = (g: GroupBy) =>
    g === "grade" ? t("groupByGrade") : g === "type" ? t("groupByType") : t("groupByDepartment");

  const hcCols: { key: keyof HeadcountRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "group_key", label: groupColLabel },
    { key: "count", label: t("colHeadcount"), align: "right" },
  ];

  const rtCols: { key: keyof RetirementRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "period", label: t("colPeriod") },
    { key: "retiring_count", label: t("colRetiringCount"), align: "right" },
  ];

  const vfCols: { key: keyof VacancyRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "horizon", label: t("colHorizon") },
    { key: "count", label: t("colVacancyCount"), align: "right" },
  ];
  const horizonLabel = (h: string) =>
    h === "1_year" ? t("horizon1Year") : h === "3_years" ? t("horizon3Years") : h === "5_years" ? t("horizon5Years") : h;
  // GAP-HR-WORKFORCE-04: the backend's GROUP BY only emits a horizon row
  // when at least one employee falls in it, so a genuinely-zero bucket on an
  // otherwise-healthy response is filled in as an explicit 0 (never done
  // when `vfErrored` -- see below, where the RefreshErrorState branch is
  // used instead of this array at all). "beyond_5_years" is deliberately
  // excluded, per this item's own fix note.
  const vacancyRows: VacancyRow[] = VACANCY_HORIZON_ORDER.map((h) => {
    const found = vacancies.find((v) => v.horizon === h);
    return { horizon: horizonLabel(h) as VacancyRow["horizon"], count: found ? Number(found.count) : 0 };
  });

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={badgeSource} />
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalHeadcount")} value={hcErrored ? null : totalHeadcount} />
        <StatCard
          icon="🏢"
          iconBg="var(--bg, #f5f5f5)"
          label={groupBy === "department" ? t("statDepartments") : t("statGroups")}
          value={hcErrored ? null : headcount.length}
        />
        <StatCard icon="⏳" iconBg="var(--badbg, #fff1f0)" label={t("statRetiringSoon")} value={rtErrored ? null : retiringSoon} />
        <StatCard icon="📅" iconBg="var(--warnbg, #fffbe6)" label={t("statRetiring12")} value={rtErrored ? null : retiring12} />
      </StatGrid>

      {/*
        GAP-HR-WORKFORCE-06: a segmented control that navigates via `Link`,
        not the shared client `Segmented`/`Tabs` components under
        `_components/ds` -- both take an `onChange` callback, and a Server
        Component page (this file) cannot hand a function to a Client
        Component (see DataTable.tsx's own doc comment on the identical
        constraint for its `render` column prop). Reusing the `.seg`/`.on`
        CSS classes those components render keeps the visual result
        identical to a real Segmented control.
      */}
      <div className="seg" role="tablist" aria-label={t("groupByLabel")} style={{ marginBottom: 16 }}>
        {GROUP_BY_VALUES.map((g) => (
          <Link
            key={g}
            href={`/hr/workforce?groupBy=${g}`}
            role="tab"
            aria-selected={g === groupBy}
            className={g === groupBy ? "on" : undefined}
          >
            {groupByChoiceLabel(g)}
          </Link>
        ))}
      </div>

      <Card title={t("cardHeadcountBy", { group: groupByChoiceLabel(groupBy) })}>
        {hcErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "headcount" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<HeadcountRow>
            columns={hcCols}
            rows={headcount}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholderGroup")}
            pageSize={15}
            emptyIcon="👥"
            emptyTitle={t("emptyHeadcountTitle")}
            emptyMessage={t("emptyHeadcountMessage")}
          />
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardUpcomingRetirements")}>
          {rtErrored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "retirement forecast" })} backHref="/hr" />
            </div>
          ) : (
            <DataTable<RetirementRow>
              columns={rtCols}
              rows={retirements}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholderPeriod")}
              pageSize={10}
              emptyIcon="📅"
              emptyTitle={t("emptyRetirementsTitle")}
              emptyMessage={t("emptyRetirementsMessage")}
            />
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardVacancyForecast")}>
          {vfErrored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "vacancy forecast" })} backHref="/hr" />
            </div>
          ) : (
            <DataTable<VacancyRow>
              columns={vfCols}
              rows={vacancyRows}
              emptyIcon="📋"
              emptyTitle={t("emptyVacancyTitle")}
              emptyMessage={t("emptyVacancyMessage")}
            />
          )}
        </Card>
      </div>

      {retirementAge !== null && (
        <p style={{ fontSize: 12, color: "var(--muted, #64748b)", marginTop: 12 }}>
          {t("footnoteRetirementAge", { age: retirementAge })}
        </p>
      )}
    </div>
  );
}
