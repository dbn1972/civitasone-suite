import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES } from "../roles";
import { getGrantees } from "../../../_data/loaders";
import { GranteesTable } from "./GranteesTable";
import { ArrowLeft } from "lucide-react";

/**
 * GAP-GRANTS-GRANTEES-03 (DECISION, safest/honest default): the registry's
 * beneficiary-type CHECK allows individual|institution|society|mission (DOM-022).
 * "society" and "mission" are NOT NGOs/Trusts — a government Smart City Mission
 * is not an NGO — so the card previously labelled "NGOs" was mislabelled. It is
 * now "Societies & missions", which is exactly what it counts. A proper
 * ngo/trust type is a backend DOM-022 constraint change left as a follow-up.
 */
const SOCIETY_MISSION_TYPES: ReadonlyArray<"society" | "mission"> = ["society", "mission"];

export default async function GranteesPage() {
  const { data: grantees, source } = await getGrantees();

  // GAP-GRANTS-GRANTEES-04: only privileged grants roles see registration
  // numbers in the clear; everyone else sees the masked form.
  const canViewRegistration = hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES);

  // GAP-GRANTS-GRANTEES-01 (FAILMASK): a failed fetch must not read as an empty
  // registry (0 / 0 / 0 / 0.0%). When the load errored AND nothing came back,
  // show a real retry state instead of fabricated zero stats + "No records".
  if (source === "error" && grantees.length === 0) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="back">
          <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
        </nav>
        <PageHeader title="Grantees" subtitle="Registered grantee organisations and compliance status." />
        <RefreshErrorState
          error={toHumanError("load", { area: "grantees" })}
          backHref="/grants"
          source={{ area: "grantees" }}
        />
      </>
    );
  }

  const societiesAndMissions = grantees.filter((g) => SOCIETY_MISSION_TYPES.includes(g.type as "society" | "mission")).length;
  const totalActiveGrants = grantees.reduce((s, g) => s + g.activeGrants, 0);

  // GAP-GRANTS-GRANTEES-02 (DECISION, safest default — KPI semantics flagged
  // for grants-owner confirmation): the headline was an unweighted mean of
  // ucCompliancePct over ALL rows, so a brand-new grantee with nothing due
  // (0.0%) and an empty registry both dragged it to a misleading figure. We
  // now exclude grantees with no UC due (activeGrants === 0 is the only
  // "nothing due" signal available in GranteeSummary) and show "—" when no
  // grantee has anything due — never a fabricated 0.0%. Renamed to
  // "Avg UC compliance" to be honest that it is an average, not a portfolio
  // weighted figure (a true weighted figure needs a backend portfolio endpoint).
  const withUcDue = grantees.filter((g) => g.activeGrants > 0);
  const avgCompliance =
    withUcDue.length > 0
      ? `${(withUcDue.reduce((s, g) => s + g.ucCompliancePct, 0) / withUcDue.length).toFixed(1)}%`
      : "—";

  // When data is present but the refresh errored, stats are derived from cached
  // rows the table also shows; the table's own badge reports the provenance.
  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grantees" subtitle="Registered grantee organisations and compliance status." />
      {/* UX-012: the data-source badge lives inside GranteesTable, driven by the
          same useSeededResource call that produces its rows. */}
      <div aria-label="Grantees">
        <StatGrid>
          <StatCard icon="👤" iconBg="#f1f5f9" label="Total" value={grantees.length} />
          <StatCard icon="🏢" iconBg="#faf5ff" label="Societies & missions" value={societiesAndMissions} />
          <StatCard icon="🎁" iconBg="#dcfce7" label="Active Grants" value={totalActiveGrants} />
          <StatCard icon="📋" iconBg="#fef3c7" label="Avg UC compliance" value={avgCompliance} />
        </StatGrid>
        <Card title="Grantees">
          <GranteesTable grantees={grantees} source={source} canViewRegistration={canViewRegistration} />
        </Card>
      </div>
    </>
  );
}
