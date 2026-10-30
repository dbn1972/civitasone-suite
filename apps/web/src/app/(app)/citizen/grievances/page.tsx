import Link from "next/link";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getGrievances } from "../_data";
import type { GrievanceSummary } from "../_data";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { GrievancesTable, type GrievanceRow } from "./GrievancesTable";
import { getTranslations } from "next-intl/server";
import { daysUntilIST } from "@/lib/formatters";
import { maskName } from "../../../_components/ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { countByBucket } from "../_data/statusCounts";

// GAP-CITIZEN-GRIEVANCES-05: "today" and days-left must be computed per request
// in Asia/Kolkata, not at module load in UTC. A module-scope UTC TODAY freezes
// at server start (stale in a long-lived process) and skews the statutory clock
// by up to a day during 00:00-05:30 IST. daysUntilIST() resolves both correctly.
export const dynamic = "force-dynamic";

// GAP-CITIZEN-GRIEVANCES-03: only grievance officers/admins see full complainant
// names; everyone else sees a masked name. Resolved server-side so the full
// name is never serialised to the client for a non-privileged viewer.
const GRIEVANCE_PRIVILEGED_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export default async function GrievancesPage() {
  const t = await getTranslations("grievances");
  const result = await getGrievances();
  const { data: grievances } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const total = errored ? null : grievances.length;
  const counts = errored ? null : countByBucket(grievances);
  const pending = counts && counts.open;
  const escalated = counts && counts.escalated;
  const resolved = counts && counts.resolved;

  const canSeeNames = hasAnyRole(getSessionRoles(), GRIEVANCE_PRIVILEGED_ROLES);
  const rows: GrievanceRow[] = grievances.map((g: GrievanceSummary) => ({
    id: g.id,
    grievanceNo: g.grievanceNo,
    subject: g.subject,
    complainantName: canSeeNames ? g.complainantName : maskName(g.complainantName),
    category: g.category.replace(/_/g, " "),
    status: g.status,
    daysLeft: daysUntilIST(g.dueDate),
  }));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Link href="/citizen/requests" className="btn">
              {t("allRequestsLink")}
            </Link>
            <Link href="/citizen/grievances/new" className="btn primary">
              {t("register")}
            </Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📋" tone="info" label={t("total")} value={total === null ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="⏳" tone="warn" label={t("pending")} value={pending === null ? "—" : pending.toLocaleString("en-IN")} />
        <StatCard icon="🔺" tone="bad" label={t("escalated")} value={escalated === null ? "—" : escalated.toLocaleString("en-IN")} />
        <StatCard icon="✅" tone="good" label={t("resolved")} value={resolved === null ? "—" : resolved.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h">
              <h3>{t("tableTitle")}</h3>
            </div>
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "grievances" })} />
            </div>
          </>
        ) : grievances.length === 0 ? (
          <>
            <div className="card-h">
              <h3>{t("tableTitle")}</h3>
            </div>
            <EmptyState
              icon="📋"
              title={t("emptyTitle")}
              message={t("emptyMsg")}
            />
          </>
        ) : (
          <>
            <div className="card-h">
              <h3>{t("tableTitle")}</h3>
            </div>
            <GrievancesTable rows={rows} />
          </>
        )}
      </div>
    </>
  );
}
