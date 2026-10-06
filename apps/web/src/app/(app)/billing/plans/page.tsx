import { PageHeader, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles, hasAnyRole, BILLING_PLAN_ADMIN_ROLES } from "@/lib/auth/roleGuard";

// GAP-BILLING-PLANS-01/02/04/06: the billing-service plan read model
// (services/billing-service/src/modules/plans/repo.ts `toView`) returns
// { id, name, code, priceMinor (string paise), currency, govtExempt, active }.
// There is NO `amount`, `interval`, `status` or `createdAt` field. The generic
// moduleLoader/mapModuleRows flattened plans to id/label/status/meta, dropping
// the price/currency/govtExempt entirely and showing a truncated uuid as the
// first column. This bespoke, typed loader surfaces the price (formatMoney),
// the human code as the first column, and links each row to its detail page.
export interface PlanRow extends Record<string, unknown> {
  id: string;
  name: string;
  code: string;
  priceMinor: string;
  currency: string;
  govtExempt: boolean;
  /** Derived from the boolean `active` flag — the backend has no status enum. */
  status: string;
  govtExemptLabel: string;
}

async function getPlans(): Promise<LoaderResult<PlanRow[]>> {
  return fetchJson<unknown, PlanRow[]>("/api/v1/billing/plans", [], {
    telemetryKey: "billing.plans.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown[] })?.data;
      if (!Array.isArray(arr)) return null;
      const rows: PlanRow[] = [];
      for (const r of arr) {
        if (!r || typeof r !== "object") continue;
        const rec = r as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : null;
        if (!id) continue;
        const priceMinor =
          typeof rec.priceMinor === "string"
            ? rec.priceMinor
            : typeof rec.priceMinor === "number"
              ? String(rec.priceMinor)
              : null;
        const active = rec.active === true;
        const govtExempt = rec.govtExempt === true;
        rows.push({
          id,
          name: typeof rec.name === "string" ? rec.name : "—",
          code: typeof rec.code === "string" ? rec.code : id.replace(/-/g, "").slice(0, 8),
          priceMinor: priceMinor !== null && /^-?\d+$/.test(priceMinor) ? priceMinor : "",
          currency: typeof rec.currency === "string" ? rec.currency : "INR",
          govtExempt,
          status: active ? "active" : "inactive",
          govtExemptLabel: govtExempt ? "Yes" : "No",
        });
      }
      // GAP-BILLING-PLANS-03 (scoped to this bespoke loader, NOT the shared
      // mapModuleRows): a non-empty array whose rows ALL fail to parse is a
      // contract break, not a genuinely empty plan list — surface it as an
      // error (null → source "error") rather than a misleading "No plans yet".
      // A truly empty [] stays a valid empty state.
      if (arr.length > 0 && rows.length === 0) return null; // ux-001-ok: all-rows-unparseable is a contract break, surfaced as an error not an empty list
      return rows;
    },
  });
}

export default async function BillingPlansPage() {
  const { data: plans, source, status, errorMessage } = await getPlans();
  // GAP-BILLING-PLANS-05: only super_admin may create plans (matches the
  // billing-service requireSuperAdmin on POST /v1/billing/plans). Hide the
  // control and the empty-state CTA otherwise.
  const canCreate = hasAnyRole(getSessionRoles(), BILLING_PLAN_ADMIN_ROLES);

  const newPlanLink = canCreate ? (
    <a href="/billing/plans/new" className="btn primary" style={{ minHeight: 44 }}>
      + New Plan
    </a>
  ) : null;

  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Billing — Plans" subtitle="All billing plans." back="/billing" />
        <LoadErrorState result={{ status, errorMessage }} area="plans" backHref="/billing" />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Billing — Plans" subtitle="All billing plans." back="/billing" />
      {newPlanLink}

      <DataTable<PlanRow>
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "priceMinor", label: "Price", align: "right", cellType: "money", currencyKey: "currency" },
          { key: "govtExemptLabel", label: "Govt exempt" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={plans}
        rowLinkKey="id"
        rowLinkPrefix="/billing/plans/"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder="Filter by code, name, or status…"
        pageSize={15}
        emptyIcon="📦"
        emptyTitle="No plans yet"
        emptyMessage="No billing plans have been created yet."
        emptyAction={
          canCreate ? (
            <a href="/billing/plans/new" className="btn primary" style={{ minHeight: 44 }}>
              Create the first plan
            </a>
          ) : undefined
        }
      />
    </div>
  );
}
