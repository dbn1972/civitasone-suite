import Link from "next/link";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getGrievances } from "../_data";
import type { GrievanceSummary } from "../_data";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { GrievancesTable, type GrievanceRow } from "./GrievancesTable";
import { serverT } from "@/lib/i18n/server";

const TODAY = new Date().toISOString().slice(0, 10);

/** CPGRAMS 30-day lifecycle: returns whole days remaining (negative = overdue). */
function daysRemaining(dueDate: string | null | undefined, today: string): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const t = new Date(today);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

const CLOSED_STATUSES = new Set(["resolved", "closed", "disposed"]);

export default async function GrievancesPage() {
  const t = serverT();
  const result = await getGrievances();
  const { data: grievances } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : grievances.length;
  const pending = errored
    ? null
    : grievances.filter(
        (g) => g.status === "pending" || g.status === "registered" || g.status === "under_review" || g.status === "assigned",
      ).length;
  const escalated = errored ? null : grievances.filter((g) => g.status === "escalated").length;
  const resolved = errored ? null : grievances.filter((g) => CLOSED_STATUSES.has(g.status.toLowerCase())).length;

  const rows: GrievanceRow[] = grievances.map((g: GrievanceSummary) => ({
    id: g.id,
    grievanceNo: g.grievanceNo,
    subject: g.subject,
    complainantName: g.complainantName,
    category: g.category.replace(/_/g, " "),
    status: g.status,
    daysLeft: daysRemaining(g.dueDate, TODAY),
  }));

  return (
    <>
      <PageHeader
        title={t("grievances.title")}
        subtitle={t("grievances.subtitle")}
        actions={
          <Link href="/citizen/grievances/new" className="btn primary">
            {t("grievances.register")}
          </Link>
        }
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label={t("grievances.total")} value={total === null ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={t("grievances.pending")} value={pending === null ? "—" : pending.toLocaleString("en-IN")} />
        <StatCard icon="🔺" iconBg="#fef3f2" label={t("grievances.escalated")} value={escalated === null ? "—" : escalated.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("grievances.resolved")} value={resolved === null ? "—" : resolved.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h">
              <h3>{t("grievances.tableTitle")}</h3>
            </div>
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "grievances" })} />
            </div>
          </>
        ) : grievances.length === 0 ? (
          <>
            <div className="card-h">
              <h3>{t("grievances.tableTitle")}</h3>
            </div>
            <EmptyState
              icon="📋"
              title={t("grievances.emptyTitle")}
              message={t("grievances.emptyMsg")}
            />
          </>
        ) : (
          <>
            <div className="card-h">
              <h3>{t("grievances.tableTitle")}</h3>
            </div>
            <GrievancesTable rows={rows} />
          </>
        )}
      </div>
    </>
  );
}
