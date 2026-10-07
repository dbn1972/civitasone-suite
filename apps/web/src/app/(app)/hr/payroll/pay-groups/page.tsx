import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreatePayGroupForm } from "./CreatePayGroupForm";
import { PayGroupCard } from "./PayGroupCard";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { todayIST } from "@/lib/formatters";
import { MembershipSettings } from "./MembershipSettings";
import { getActiveDdos, getMembershipSettings, getUnassignedTotal } from "./payGroupData";
import { hasNoRows, isBillType } from "./payGroupMembership";

/**
 * GET /v1/payroll/pay-groups (payroll-service gap-routes.ts) returns only
 * id/name/frequency/pay_day_of_month/timezone/status/created_at, and only
 * ACTIVE groups. employeeCount / salaryStructureName / lastRevisionDate are
 * optional because the API does not send them today.
 */
type Row = {
  id: string;
  name: string;
  frequency: string;
  pay_day_of_month: number;
  pay_weekday?: number | null;
  pay_last_day?: boolean | null;
  pay_week_parity?: number | null;
  timezone: string;
  status: string;
  employeeCount?: number;
  ddo_code?: string | null;
  bill_type?: string | null;
  salaryStructureName?: string;
  lastRevisionDate?: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  // GAP-PAYROLL-PAY-GROUPS-03: includeInactive so a deactivated group stays
  // visible (and can be reactivated) instead of silently disappearing.
  return fetchJson<unknown, Row[]>("/api/v1/payroll/pay-groups?includeInactive=true", [], {
    telemetryKey: "payroll.pay-groups",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function PayGroupsPage({ searchParams }: { searchParams?: { edit?: string } }) {
  const t = await getTranslations("payrollPayGroups");

  // GAP-PAYROLL-PAY-GROUPS-04: GET is READER_ROLES and POST is PAYROLL_ROLES
  // in payroll-service; hr/layout.tsx admits employee/manager too.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="pay groups" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const [result, ddosResult, unassignedResult, settingsResult] = await Promise.all([
    getData(),
    canAdminister ? getActiveDdos() : Promise.resolve({ data: [], source: "api" as const }),
    getUnassignedTotal(todayIST().slice(0, 7)),
    canAdminister ? getMembershipSettings() : Promise.resolve({ data: null, source: "api" as const }),
  ]);
  const { data: groups } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-PAYROLL-PAY-GROUPS-03: deactivated ('archived') groups are listed too,
  // so Inactive is a real count and the frequency breakdown counts active
  // groups only.
  const isActiveRow = (g: Row) => g.status === "active";
  const activeGroups = groups.filter(isActiveRow);
  const inactiveCount = errored ? null : groups.length - activeGroups.length;
  const monthlyCount = errored ? null : activeGroups.filter((g) => g.frequency === "monthly").length;
  const biWeeklyCount = errored ? null : activeGroups.filter((g) => g.frequency === "bi_weekly").length;
  const weeklyCount = errored ? null : activeGroups.filter((g) => g.frequency === "weekly").length;
  const editId = searchParams?.edit?.trim();
  const editRow = editId ? groups.find((g) => g.id === editId && isActiveRow(g)) : undefined;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />
      {/* GAP-PAYROLL-PAY-GROUPS-05: same data-source badge as sibling pages. */}
      <DataSourceBadge source={result.source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statActive")} value={errored ? null : activeGroups.length} />
        <StatCard icon="📅" iconBg="var(--warnbg)" label={t("statMonthly")} value={monthlyCount} />
        <StatCard icon="📆" iconBg="var(--goodbg)" label={t("statBiWeekly")} value={biWeeklyCount} />
        <StatCard icon="🗓️" iconBg="var(--panel)" label={t("statWeekly")} value={weeklyCount} />
        <StatCard icon="🚫" iconBg="var(--badbg)" label={t("statInactive")} value={inactiveCount} />
        {/* Employees a run would pay but who sit in no pay group this month; "—" when the count is unavailable. */}
        <StatCard
          icon="⚠️"
          tone="warn"
          label={t("statUnassigned")}
          value={unassignedResult.source === "error" ? null : unassignedResult.data}
          href="/hr/payroll/pay-groups/unassigned"
          hint={t("statUnassignedHint")}
        />
      </StatGrid>

      {canAdminister && (
        <CreatePayGroupForm
          key={editRow?.id ?? "new"}
          {...(editRow
            ? {
                editing: {
                  id: editRow.id, name: editRow.name, frequency: editRow.frequency as "monthly" | "bi_weekly" | "weekly",
                  payDayOfMonth: editRow.pay_day_of_month, payWeekday: editRow.pay_weekday ?? null,
                  payLastDay: editRow.pay_last_day === true, payWeekParity: editRow.pay_week_parity ?? null,
                  timezone: editRow.timezone,
                  ddoCode: editRow.ddo_code ?? null,
                  billType: isBillType(editRow.bill_type) ? editRow.bill_type : null,
                },
              }
            : {})}
          ddos={ddosResult.data}
          ddosUnavailable={ddosResult.source === "error"}
        />
      )}
      {canAdminister && (
        <MembershipSettings allowMidMonth={settingsResult.source === "error" ? null : settingsResult.data} />
      )}
      <p style={{ margin: "0 0 12px" }}>
        <Link href="/hr/payroll/pay-groups/unassigned">{t("unassignedLink")}</Link>
      </p>

      {errored ? (
        <Card title={t("cardTitle")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay groups" })} backHref="/hr/payroll" />
          </div>
        </Card>
      ) : hasNoRows(groups) ? (
        <Card title={t("cardTitle")}>
          <EmptyState
            icon="👥"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        </Card>
      ) : (
        <Card title={t("cardsTitle")}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
              padding: 16,
            }}
          >
            {groups.map((g) => (
              <PayGroupCard
                key={g.id}
                id={g.id}
                name={g.name}
                frequency={g.frequency}
                payDayOfMonth={g.pay_day_of_month}
                payWeekday={g.pay_weekday ?? null}
                payLastDay={g.pay_last_day ?? false}
                payWeekParity={g.pay_week_parity ?? null}
                canAdminister={canAdminister}
                timezone={g.timezone}
                status={g.status}
                employeeCount={typeof g.employeeCount === "number" ? g.employeeCount : undefined}
                associatedStructureName={g.salaryStructureName}
                lastRevisionDate={g.lastRevisionDate}
                ddoCode={g.ddo_code ?? null}
                billType={g.bill_type ?? null}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
