import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid, EmptyState, StatusPill, LoadErrorState } from "../../../../_components/ds";
import { getBillingPlanById } from "../../../../_data/loaders";
import { formatMoneyIn } from "@/lib/formatters";

// GAP-BILLING-PLANS-DETAIL-01/02/04: the billing-service GET /v1/billing/plans/:id
// returns PlanView = { id, name, code, priceMinor (string paise), currency,
// govtExempt, active } (plans/repo.ts toView). It does NOT return `amount`,
// `interval`, `status`, or `createdAt`. The old page read all four of those
// non-existent fields and papered over the misses with fabricated defaults
// ("Unnamed Plan", status "active", currency "INR"), and printed money as raw
// `INR {amount}`. This page reads the real fields, formats paise with
// formatMoneyIn, and shows "—" (never a fabricated value) when a field is
// genuinely absent.
export default async function PlanDetailPage({ params }: { params: { id: string } }) {
  const { data: plan, source, status, errorMessage } = await getBillingPlanById(params.id);

  // GAP-BILLING-PLANS-DETAIL-03: a transient/permission failure must not read
  // as "Plan not found". Only a real 404 (or a null plan on a successful read)
  // is "not found"; a 5xx is retryable, a 403 is access-restricted.
  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Plan Detail" back="/billing/plans" />
        <LoadErrorState result={{ status, errorMessage }} area="plan" backHref="/billing/plans" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="page-main" aria-labelledby="page-heading">
        <PageHeader title="Plan Detail" back="/billing/plans" />
        <EmptyState icon="📦" title="Plan not found" message="This plan may have been removed or the ID is invalid." />
      </div>
    );
  }

  // GAP-BILLING-PLANS-DETAIL-04: no fabricated defaults — "—" for anything
  // the payload genuinely omits.
  const name = typeof plan.name === "string" && plan.name.trim() ? plan.name : "—";
  const code = typeof plan.code === "string" && plan.code.trim() ? plan.code : "—";
  const currency = typeof plan.currency === "string" ? plan.currency : null;
  const priceMinor =
    typeof plan.priceMinor === "string" || typeof plan.priceMinor === "number" ? plan.priceMinor : null;
  const priceDisplay = priceMinor !== null ? formatMoneyIn(priceMinor, currency) : "—";
  const active = typeof plan.active === "boolean" ? plan.active : null;
  const statusLabel = active === null ? null : active ? "active" : "inactive";
  const govtExempt = typeof plan.govtExempt === "boolean" ? plan.govtExempt : null;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-BILLING-PLANS-DETAIL-05: PageHeader `back` is the single back
          affordance; the hand-rolled plain-<a> breadcrumb that duplicated it is
          removed. Any remaining in-page links use next/link for client nav. */}
      <PageHeader title={name} subtitle={code !== "—" ? code : "Billing plan details"} back="/billing/plans" />

      <StatGrid>
        <StatCard icon="💰" label="Price" value={priceDisplay} />
        <StatCard icon="🏛️" label="Govt exempt" value={govtExempt === null ? "—" : govtExempt ? "Yes" : "No"} />
        <StatCard icon="📊" label="Status" value={statusLabel ? (active ? "Active" : "Inactive") : "—"} />
      </StatGrid>

      <Card title="Plan details" padding>
        <div className="fields">
          <div className="field"><span className="label">Plan ID</span><span className="mono">{params.id}</span></div>
          <div className="field"><span className="label">Code</span><span>{code}</span></div>
          <div className="field"><span className="label">Name</span><span>{name}</span></div>
          <div className="field"><span className="label">Price</span><span>{priceDisplay}</span></div>
          <div className="field"><span className="label">Govt exempt</span><span>{govtExempt === null ? "—" : govtExempt ? "Yes" : "No"}</span></div>
          <div className="field">
            <span className="label">Status</span>
            <span>{statusLabel ? <StatusPill status={statusLabel} /> : "—"}</span>
          </div>
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/billing/subscriptions" className="btn ghost sm">View subscriptions</Link>
        </p>
      </Card>
    </div>
  );
}
