import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TravelRequestForm } from "./TravelRequestForm";
import { TravelApprovalsTable } from "./TravelApprovalsTable";
import { TravelRequestsTable } from "./TravelRequestsTable";
import { mapTravel, mapTravelTeam, type ApiTravelRow, type ApiTravelTeamRow, type Row, type TeamRow } from "./mapTravel";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { HR_STAFF_MANAGER_ROLES } from "@/lib/auth/workRoles";

// GAP-HR-TRAVEL-01: only these roles can see/act on the team approval queue
// -- mirrors the backend's own gate on scope=team and approve/reject
// exactly (social/routes.ts).
const TRAVEL_APPROVER_ROLES = HR_STAFF_MANAGER_ROLES;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/travel-requests", [], {
    telemetryKey: "hr.travel",
    mapResponse: (p) => {
      const arr = (p as { data?: ApiTravelRow[] })?.data;
      return Array.isArray(arr) ? mapTravel(arr) : null;
    },
  });
}

async function getTeamData(): Promise<LoaderResult<TeamRow[]>> {
  return fetchJson<unknown, TeamRow[]>("/api/v1/hrms/travel-requests?scope=team", [], {
    telemetryKey: "hr.travel.team",
    mapResponse: (p) => {
      const arr = (p as { data?: ApiTravelTeamRow[] })?.data;
      return Array.isArray(arr) ? mapTravelTeam(arr) : null;
    },
  });
}

export default async function TravelRequestsPage() {
  const t = await getTranslations("travel");
  const roles = getSessionRoles();
  const isApprover = roles.some((r) => TRAVEL_APPROVER_ROLES.includes(r));

  const { data: items, source } = await getData();
  const errored = source === "error";

  // Only fetch the team-approval queue for an approver -- avoids the extra
  // backend round trip (and its cross-schema employee-name lookups) on
  // every plain-employee page view.
  const teamResult = isApprover ? await getTeamData() : null;
  // GAP-HR-TRAVEL-01: UI-side segregation-of-duties hint -- the approvals table
  // never offers Approve / Reject on the viewer's own request. The server is
  // still the authority (403 SELF_APPROVAL) and does not list it in the queue.
  const currentUserId = getSessionUserId();

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel={t("backToHr")}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="✈️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("statRejected")} value={errored ? null : rejected} />
      </StatGrid>
      <TravelRequestForm />

      {/* GAP2-HR-TRAVEL-07: a FAILED team-queue fetch must not render as
          "nothing to approve". The old code only rendered this card when
          teamResult.source !== "error", silently omitting the whole approvals
          section on a failed fetch. Mirror the self-list's own RefreshErrorState
          branch so an approver sees an explicit error instead.
          GAP2-HR-TRAVEL-08: title is now an i18n key, not a hard-coded literal. */}
      {teamResult && (
        <div style={{ marginTop: 16 }}>
          <Card title={t("pendingApprovalsCardTitle")}>
            {teamResult.source === "error" ? (
              <div className="pad">
                <RefreshErrorState error={toHumanError("load", { area: "pending approvals" })} backHref="/hr" />
              </div>
            ) : (
              <TravelApprovalsTable rows={teamResult.data} currentUserId={currentUserId} />
            )}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitle")}>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "travel requests" })} backHref="/hr" />
            </div>
          ) : (
            <TravelRequestsTable rows={items} isApprover={isApprover} />
          )}
        </Card>
      </div>
    </div>
  );
}
