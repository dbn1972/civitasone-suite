import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getRTIApplications } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { daysUntilIST } from "@/lib/formatters";
import { isRtiClosed } from "@/lib/rtiStatus";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { RTIClient } from "./RTIClient";
import { RegisterRTIButton } from "./RegisterRTIButton";

// GAP-CITIZEN-RTI-06: RTI applicant identity is DPDP-protected personal data.
// Only PIO/CPIO-equivalent officer roles may see the full applicant name; every
// other signed-in user sees a masked name. This mirrors the backend's
// OFFICER_ROLES (citizen-service rti/routes.ts).
const RTI_PII_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

// GAP-CITIZEN-RTI-07: the §7 statutory clock must be computed per request in
// Asia/Kolkata, not once at module load in UTC. A module-scope
// `new Date().toISOString()` froze at server start (stale in a long-lived
// process) and skewed the clock by up to a day during 00:00-05:30 IST.
// daysUntilIST() (used for the stats below, and inside RTIClient) resolves the
// IST calendar day per call; force-dynamic so each request re-derives the stats
// (mirrors citizen/grievances).
export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("citizenRti");
  const canSeePii = hasAnyRole(getSessionRoles(), RTI_PII_ROLES);
  const { data: rtis, source } = await getRTIApplications();
  const errored = source === "error";

  // GAP-CITIZEN-RTI-04: stats must match the list segments' predicates.
  // "Open" = still within the §7 clock (not closed); "Overdue" = past the
  // 30-day deadline and not closed. Both use the shared isRtiClosed helper
  // and IST calendar-day arithmetic so no stat contradicts the table.
  const open = errored ? null : rtis.filter((r) => !isRtiClosed(r.status)).length;
  const replied = errored ? null : rtis.filter((r) => r.status === "replied").length;
  const overdue = errored
    ? null
    : rtis.filter((r) => {
        if (isRtiClosed(r.status)) return false;
        const n = daysUntilIST(r.deadlineDate);
        return n !== null && n < 0;
      }).length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        help="citizen"
        actions={<RegisterRTIButton />}
      />
      <StatGrid>
        <StatCard icon="📄" iconBg="#e0f5fa" label={t("statApplications")} value={errored ? "—" : rtis.length.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label={t("statOpen")} value={open === null ? "—" : open.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label={t("statOverdue")} value={overdue === null ? "—" : overdue.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statReplied")} value={replied === null ? "—" : replied.toLocaleString("en-IN")} />
      </StatGrid>
      {errored ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h"><h3>{t("applicationListTitle")}</h3></div>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "RTI applications" })} />
          </div>
        </div>
      ) : (
        <RTIClient rtis={rtis} canSeePii={canSeePii} />
      )}
    </>
  );
}
