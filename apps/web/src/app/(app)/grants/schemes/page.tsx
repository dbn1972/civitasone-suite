import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { getGrantSchemes } from "../_data";
import { GRANTS_MAKER_ROLES } from "../roles";
import { SchemesTable } from "./SchemesTable";

export default async function GrantSchemesPage() {
  const { data: schemes, source, droppedCount } = await getGrantSchemes();

  // GAP-GRANTS-SCHEMES-01: only grant makers see the "+ New Scheme" action; the
  // grant-service POST /schemes enforces the same roles (SCHEME_ROLES).
  const canMaintain = hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES);
  const failed = source === "error";

  // GAP-GRANTS-SCHEMES-03: "Total Budget" is the sanctioned envelope — only
  // schemes that are actually agreed (open/closed/completed), excluding draft,
  // cancelled and unknown. Decision recorded: sum SANCTIONED statuses, not all.
  const SANCTIONED = new Set(["open", "closed", "completed"]);
  const open = schemes.filter((s) => s.status === "open").length;
  const totalBudget = schemes
    .filter((s) => SANCTIONED.has(s.status))
    .reduce((sum, s) => sum + s.budgetMinor, 0);
  const totalDisbursed = schemes.reduce((sum, s) => sum + s.disbursedMinor, 0);

  // GAP-GRANTS-SCHEMES-04: applicationCount may be null (API didn't send it).
  // Sum only the numbers; show "—" when every row is null.
  const appCounts = schemes.map((s) => s.applicationCount).filter((c): c is number => c != null);
  const totalApplications = appCounts.length > 0 ? appCounts.reduce((a, b) => a + b, 0) : null;

  // GAP-GRANTS-SCHEMES-02: on a failed load show "—", never a fabricated 0.
  const dash = "—";

  return (
    <>
      <PageHeader
        title="Grant Schemes"
        subtitle="Browse and manage government grant schemes."
        back="/grants"
        backLabel="Grants"
        help="grants"
        actions={
          canMaintain && !failed ? (
            <Link href="/grants/schemes/new" className="btn primary">
              + New Scheme
            </Link>
          ) : undefined
        }
      />
      <div aria-label="Grant schemes">
        {/* GAP-GRANTS-SCHEMES-05: surface rows the mapper had to hide so the
            list is honest about being incomplete. */}
        {droppedCount > 0 && (
          <p role="status" style={{ color: "var(--warn, #b45309)", fontSize: 13, margin: "0 0 8px" }}>
            {droppedCount} scheme{droppedCount === 1 ? "" : "s"} could not be displayed because the
            record was incomplete.
          </p>
        )}
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total Schemes" value={failed ? dash : schemes.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Open" value={failed ? dash : open} />
          <StatCard
            icon="💰"
            iconBg="#dbeafe"
            label="Total Budget (sanctioned)"
            value={failed ? dash : formatMoney(totalBudget)}
          />
          <StatCard
            icon="📤"
            iconBg="#fef3c7"
            label="Disbursed"
            value={failed ? dash : formatMoney(totalDisbursed)}
          />
          <StatCard
            icon="📝"
            iconBg="#ede9fe"
            label="Applications"
            value={failed || totalApplications == null ? dash : totalApplications}
          />
        </StatGrid>
        <Card title="Schemes">
          <SchemesTable schemes={schemes} source={source} canMaintain={canMaintain} />
        </Card>
      </div>
    </>
  );
}
