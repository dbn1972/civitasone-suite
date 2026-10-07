import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TravelRequestForm } from "./TravelRequestForm";
import { TravelApprovalsTable } from "./TravelApprovalsTable";
import { mapTravel, mapTravelTeam, type ApiTravelRow, type ApiTravelTeamRow, type Row, type TeamRow } from "./mapTravel";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// GAP-HR-TRAVEL-01: only these roles can see/act on the team approval queue
// -- mirrors the backend's own gate on scope=team and approve/reject
// exactly (social/routes.ts).
const TRAVEL_APPROVER_ROLES = ["manager", "hr_admin", "hr_officer", "super_admin"];

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

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" | "date" }[] = [
    { key: "destination", label: t("colDestination") },
    { key: "purpose", label: t("colPurpose") },
    // GAP-HR-TRAVEL-04: cellType "date" (existing DataTable support) instead
    // of printing the raw value -- a node-postgres DATE column can arrive
    // as an ISO timestamp ("...T00:00:00.000Z"), and this page never
    // formatted either shape.
    { key: "from_date", label: t("colFrom"), cellType: "date" },
    { key: "to_date", label: t("colTo"), cellType: "date" },
    { key: "mode", label: t("colMode") },
    // GAP-HR-TRAVEL-02: advance_required was fetched but never shown.
    { key: "advanceRequired", label: t("colAdvance"), cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="✈️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="❌" iconBg="var(--badbg, #fef2f2)" label={t("statRejected")} value={errored ? null : rejected} />
      </StatGrid>
      <TravelRequestForm />

      {teamResult && teamResult.source !== "error" && (
        <div style={{ marginTop: 16 }}>
          <Card title="Pending Approvals">
            <TravelApprovalsTable rows={teamResult.data} />
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
            <DataTable<Row>
              columns={columns}
              rows={items}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="✈️"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
