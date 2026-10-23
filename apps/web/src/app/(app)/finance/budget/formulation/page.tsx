import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { getFinanceBudgets } from "../../../../_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { FyFilter } from "../../_components/FyFilter";
import { FormulationTable } from "./FormulationTable";
import { formatMoney } from "@/lib/formatters";
import { BUDGET_TAB_ALL, budgetTabOf, parseBudgetTab, priorYearBeByHead } from "../_lib/budgetColumns";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BudgetFormulationPage(
  props: {
    searchParams?: Promise<{ fy?: string; tab?: string; highlight?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("financeBudgetFormulation");
  // GAP-FINANCE-BUDGET-FORMULATION-02: the headline is THIS fiscal year's
  // proposed Budget Estimate. It used to sum sanctionedAmount (the live RE)
  // across EVERY fiscal year and label that "Proposed Outlay". The FY comes
  // from the FyFilter (?fy=), validated, defaulting to the current FY.
  const fy =
    typeof searchParams?.fy === "string" && isValidFinancialYearLabel(searchParams.fy)
      ? searchParams.fy
      : currentFinancialYear();

  const result = await getFinanceBudgets();
  // GAP-FINANCE-BUDGET-FORMULATION-03: a failed fetch shows "—" cards and a
  // Retry state, never ₹0.00 / 0 above "No records found".
  const errored = toResourceState(result).status === "error";
  const budgets = result.data.filter((b) => b.financialYear === fy);

  // beMinor is a minor-unit (paise) decimal string — sum as BigInt so
  // formatMoney() gets the right scale and large budgets can't drift.
  const totalBe = budgets.reduce((s, b) => s + BigInt(b.beMinor || "0"), 0n);
  const pending = budgets.filter((b) => b.status === "pending").length;
  const approved = budgets.filter((b) => b.status === "approved").length;
  // GAP-FINANCE-BUDGET-FORMULATION-01: last year's BE for the same head, from
  // the previous FY's rows (absent -> the table shows "—", never a guess).
  const priorBe = priorYearBeByHead(result.data, fy);
  const uniqueHeads = new Set(budgets.map((b) => b.majorHead)).size;

  // GAP-FINANCE-BUDGET-FORMULATION-05: after creating an estimate the form links here with ?highlight=<id>; open the
  // tab that row is listed under (an explicit ?tab= wins) and announce it. Both are validated; anything else is ignored.
  const highlightId =
    typeof searchParams?.highlight === "string" && UUID_RE.test(searchParams.highlight) ? searchParams.highlight : undefined;
  const highlightedRow = highlightId ? budgets.find((b) => b.id === highlightId) : undefined;
  const initialTab = parseBudgetTab(searchParams?.tab) ?? (highlightedRow ? budgetTabOf(highlightedRow.status) : BUDGET_TAB_ALL);

  return (
    <>
      <PageHeader
        title="Budget Formulation"
        subtitle="Prepare departmental budget estimates by major/minor head."
        actions={
          <>
            <FyFilter />
            {/* "Circular" used to point at the same href as "+ New Estimate" —
                there is no separate circular/notice feature to link to, so the
                duplicate (misleading) action is removed rather than left as a
                dead second button to the same form. */}
            <a href="/finance/budget/formulation/new" className="btn primary">+ New Estimate</a>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📝" tone="info" label={`Budget Heads (FY ${fy})`} value={errored ? "—" : budgets.length} />
        <StatCard icon="🏢" tone="info" label="Major Heads" value={errored ? "—" : uniqueHeads} delta={errored ? undefined : `${t("status.approved").toLowerCase()} ${approved}`} up={true} />
        <StatCard icon="💰" tone="warn" label={`Proposed Outlay (BE, FY ${fy})`} value={errored ? "—" : formatMoney(totalBe)} up={false} />
        <StatCard icon="⏳" tone="bad" label={t("status.pending")} value={errored ? "—" : pending} />
      </StatGrid>
      <Card title={`Budget estimates (BE) — FY ${fy}`}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "budget estimates" })} backHref="/finance" />
          </div>
        ) : (
          /* UX-012: the data-source badge lives inside FormulationTable. */
          (<FormulationTable budgets={budgets} source="api" priorBe={priorBe} initialTab={initialTab} {...(highlightId ? { highlightId } : {})} />)
        )}
      </Card>
    </>
  );
}
