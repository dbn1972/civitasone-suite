import Link from "next/link";
import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState, RefreshErrorState } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { getLocale, getTranslations } from "next-intl/server";
import { ActiveToggle } from "../../_components/ActiveToggle";
import { AssignEmployeeButton, BulkAssignButton } from "../MembershipDialogs";
import { MembersTable } from "../MembersTable";
import { Pager } from "../Pager";
import { getActiveGroups } from "../payGroupData";
import { PayGroupTabs } from "../PayGroupTabs";
import { formatPayDay, frequencyLabel } from "../payDayLabel";
import {
  MEMBERS_PAGE_SIZE,
  firstOfNextMonth,
  hasNoRows,
  isBillType,
  isMemberStatus,
  parseOffset,
  parseTab,
  type GroupOption,
  type MemberRow,
} from "../payGroupMembership";

type GroupDetail = {
  id: string;
  name: string;
  frequency: string;
  pay_day_of_month: number;
  pay_weekday?: number | null;
  pay_last_day?: boolean | null;
  pay_week_parity?: number | null;
  timezone: string;
  status: string;
  ddo_code?: string | null;
  ddo_name?: string | null;
  bill_type?: string | null;
  member_count?: number;
  active_run_count?: number;
  created_at?: string;
};

type MembersPage = { data: MemberRow[]; total: number };

async function getGroup(id: string) {
  return fetchJson<unknown, GroupDetail | null>(`/api/v1/payroll/pay-groups/${encodeURIComponent(id)}`, null, {
    telemetryKey: "payroll.pay-group.detail",
    mapResponse: (p) => {
      const o = p as Partial<GroupDetail> | null;
      return o && typeof o === "object" && typeof o.id === "string" ? (o as GroupDetail) : null;
    },
  });
}

async function getMembers(id: string, history: boolean, offset: number) {
  const qs = `history=${history}&limit=${MEMBERS_PAGE_SIZE}&offset=${offset}`;
  return fetchJson<unknown, MembersPage>(`/api/v1/payroll/pay-groups/${encodeURIComponent(id)}/members?${qs}`, { data: [], total: 0 }, {
    telemetryKey: "payroll.pay-group.members",
    mapResponse: (p) => {
      const o = p as { data?: unknown; total?: unknown } | null;
      if (!o || !Array.isArray(o.data)) return null;
      const rows = (o.data as MemberRow[]).filter((r) => isMemberStatus(r.status));
      return { data: rows, total: typeof o.total === "number" ? o.total : rows.length };
    },
  });
}

export default async function PayGroupDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string; history?: string; offset?: string };
}) {
  const t = await getTranslations("payGroupMembers");
  const tc = await getTranslations("payGroupCard");
  const locale = await getLocale();

  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="pay groups" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll/pay-groups" backLabel={t("backToList")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const tab = parseTab(searchParams?.tab);
  const history = searchParams?.history === "true";
  const offset = parseOffset(searchParams?.offset);

  const result = await getGroup(params.id);
  const group = result.data;
  if (result.source === "error" || !group) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("errorTitle")} back="/hr/payroll/pay-groups" backLabel={t("backToList")} />
        <Card padding>
          {result.status === 404 ? (
            <p>{t("notFoundMessage")}</p>
          ) : (
            <LoadErrorState result={result} area={t("loadArea")} backHref="/hr/payroll/pay-groups" backLabel={t("backToList")} />
          )}
        </Card>
      </div>
    );
  }

  const isActive = group.status === "active";
  const base = `/hr/payroll/pay-groups/${group.id}`;
  const defaultDate = firstOfNextMonth(todayIST());
  const membersNode =
    tab === "members"
      ? await MembersTab({
          groupId: group.id,
          base,
          isActive,
          canAdminister,
          history,
          offset,
          defaultDate,
          group: { id: group.id, name: group.name },
        })
      : null;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={group.name} subtitle={t("detailSubtitle")} back="/hr/payroll/pay-groups" backLabel={t("backToList")} />
      <PayGroupTabs payGroupId={group.id} active={tab} />
      {tab === "details" ? (
        <Card title={t("detailsTitle")} padding>
          <div className="fields">
            <div className="fld">
              <span className="l">{t("fieldStatus")}</span>
              <span className="v">
                <StatusPill status={group.status} label={isActive ? tc("statusActive") : tc("statusInactive")} />
              </span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldFrequency")}</span>
              <span className="v">{frequencyLabel(tc, group.frequency)}</span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldPayDay")}</span>
              <span className="v">
                {formatPayDay(tc, locale, {
                  frequency: group.frequency,
                  payDayOfMonth: group.pay_day_of_month,
                  payWeekday: group.pay_weekday ?? null,
                  payLastDay: group.pay_last_day ?? false,
                  payWeekParity: group.pay_week_parity ?? null,
                })}
              </span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldTimezone")}</span>
              <span className="v">{group.timezone}</span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldDdo")}</span>
              <span className="v">
                {group.ddo_code ? (group.ddo_name ? `${group.ddo_name} (${group.ddo_code})` : group.ddo_code) : t("ddoNone")}
              </span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldBillType")}</span>
              <span className="v">{isBillType(group.bill_type) ? t(`billType.${group.bill_type}`) : "—"}</span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldMembers")}</span>
              <span className="v">
                {typeof group.member_count === "number" ? (
                  <Link href={`${base}?tab=members`}>{group.member_count.toLocaleString("en-IN")}</Link>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div className="fld">
              <span className="l">{t("fieldActiveRuns")}</span>
              <span className="v">{typeof group.active_run_count === "number" ? group.active_run_count.toLocaleString("en-IN") : "—"}</span>
            </div>
            {group.created_at && (
              <div className="fld">
                <span className="l">{t("fieldCreated")}</span>
                <span className="v">{formatIndianDate(group.created_at)}</span>
              </div>
            )}
          </div>
          {canAdminister && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
              {isActive && (
                <Link href={`/hr/payroll/pay-groups?edit=${group.id}`} className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                  {t("editBtn")}
                </Link>
              )}
              <ActiveToggle
                path={`v1/payroll/pay-groups/${group.id}/status`}
                active={isActive}
                area={tc("toggleArea")}
                conflictCodes={["INVALID_STATE"]}
                conflictMessages={{
                  PAY_GROUP_HAS_MEMBERS: t("hasMembersMessage"),
                  PAY_GROUP_HAS_ACTIVE_RUN: t("hasActiveRunMessage"),
                }}
                copy={{
                  deactivateBtn: tc("deactivateBtn"),
                  reactivateBtn: tc("reactivateBtn"),
                  deactivateTitle: tc("deactivateTitle"),
                  reactivateTitle: tc("reactivateTitle"),
                  deactivateDescription: tc("deactivateDescription"),
                  reactivateDescription: tc("reactivateDescription"),
                  reasonLabel: tc("reasonLabel"),
                  deactivatedMessage: tc("deactivatedMessage"),
                  reactivatedMessage: tc("reactivatedMessage"),
                  conflictMessage: tc("conflictMessage"),
                  networkError: tc("networkError"),
                }}
              />
            </div>
          )}
        </Card>
      ) : (
        membersNode
      )}
    </div>
  );
}

async function MembersTab({
  groupId, base, isActive, canAdminister, history, offset, defaultDate, group,
}: {
  groupId: string;
  base: string;
  isActive: boolean;
  canAdminister: boolean;
  history: boolean;
  offset: number;
  defaultDate: string;
  group: GroupOption;
}) {
  const t = await getTranslations("payGroupMembers");
  const [membersResult, targetsResult] = await Promise.all([
    getMembers(groupId, history, offset),
    canAdminister ? getActiveGroups() : Promise.resolve({ data: [] as GroupOption[], source: "api" as const }),
  ]);
  const errored = membersResult.source === "error";
  const { data: rows, total } = membersResult.data;
  const hrefFor = (o: number) => `${base}?tab=members${history ? "&history=true" : ""}${o > 0 ? `&offset=${o}` : ""}`;

  return (
    <Card title={t("membersTitle")} padding>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 12 }}>
        <Link href={history ? `${base}?tab=members` : `${base}?tab=members&history=true`} className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          {history ? t("hideHistory") : t("showHistory")}
        </Link>
        {canAdminister &&
          (isActive ? (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <AssignEmployeeButton payGroupId={group.id} payGroupName={group.name} defaultDate={defaultDate} />
              <BulkAssignButton groups={[group]} fixedGroupId={group.id} defaultDate={defaultDate} />
            </div>
          ) : (
            <p className="pill warn" style={{ margin: 0 }}>{t("inactiveNote")}</p>
          ))}
      </div>
      {canAdminister && targetsResult.source === "error" && (
        <p role="status" className="pill warn" style={{ width: "fit-content" }}>{t("targetsLoadWarning")}</p>
      )}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: t("membersArea") })} backHref="/hr/payroll/pay-groups" />
      ) : hasNoRows(rows) ? (
        <EmptyState icon="👥" title={history ? t("membersEmptyHistoryTitle") : t("membersEmptyTitle")} message={t("membersEmptyMessage")} />
      ) : (
        <>
          <MembersTable rows={rows} payGroupId={groupId} groups={targetsResult.data} canAdminister={canAdminister} defaultDate={defaultDate} />
          <Pager total={total} limit={MEMBERS_PAGE_SIZE} offset={offset} hrefFor={hrefFor} />
        </>
      )}
    </Card>
  );
}
