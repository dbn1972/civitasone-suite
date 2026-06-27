import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { getActivationEvents } from "@/app/_data/activationStore";
import { aggregateFunnel, FUNNEL_STEPS } from "@/lib/activation";

export const metadata = { title: "Activation" };

const STEP_LABELS: Record<string, string> = {
  signin: "Signed in",
  wizard_opened: "Opened setup",
  "org-profile": "Office details",
  branches: "Branch offices",
  departments: "Departments",
  people: "Invited team",
  modules: "Chose modules",
  first_transaction: "First real transaction",
};

/**
 * Activation dashboard — the north-star view. Shows Time-to-First-Real-Transaction
 * (TTFRT) and where new offices drop off along the golden path. Admin-only.
 */
export default function ActivationPage() {
  requireAnyRole(["admin", "tenant_admin", "platform_admin", "super_admin"]);

  const agg = aggregateFunnel(getActivationEvents());
  const ttfrt = agg.ttfrtMedianMinutes;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Activation"
        subtitle="How quickly new offices reach their first real transaction, and where they get stuck."
        help="tenant-admin"
      />

      <StatGrid>
        <StatCard
          icon="⏱"
          iconBg="#e7edfd"
          label="Time to first transaction (median)"
          value={ttfrt === null ? "—" : ttfrt < 60 ? `${Math.round(ttfrt)} min` : `${(ttfrt / 60).toFixed(1)} hr`}
        />
        <StatCard icon="🏢" iconBg="#eff6ff" label="Offices signed in" value={agg.stages[0]?.reached ?? 0} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Offices activated" value={agg.activatedOffices} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Activation rate" value={`${Math.round(agg.activationRate * 100)}%`} />
      </StatGrid>

      <Card title="Golden-path funnel">
        <div className="pad">
          {agg.totalOffices === 0 ? (
            <p style={{ color: "var(--mut)", fontSize: 14 }}>
              No activation events yet. As offices sign in and set up, their progress appears here.
            </p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Step</th>
                  <th style={{ textAlign: "right" }}>Offices reached</th>
                  <th style={{ textAlign: "right" }}>Dropped here</th>
                  <th style={{ textAlign: "right" }}>Kept from previous</th>
                </tr>
              </thead>
              <tbody>
                {FUNNEL_STEPS.map((step) => {
                  const stage = agg.stages.find((s) => s.step === step)!;
                  return (
                    <tr key={step}>
                      <td>{STEP_LABELS[step] ?? step}</td>
                      <td className="num">{stage.reached}</td>
                      <td className="num" style={{ color: stage.droppedFromPrev > 0 ? "#b91c1c" : "var(--mut)" }}>
                        {stage.droppedFromPrev > 0 ? `−${stage.droppedFromPrev}` : "—"}
                      </td>
                      <td className="num">{Math.round(stage.retention * 100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 12.5 }}>
        Events are kept in memory for this view; durable storage moves to the analytics service next.
        The biggest single drop tells you the most important thing to fix next.
      </p>
    </main>
  );
}
