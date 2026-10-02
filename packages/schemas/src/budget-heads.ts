/**
 * Budget-head classification rule shared by finance-service (the
 * POST /v1/finance/budgets guard and the accounts list's `type`) and the web
 * head pickers -- one function so the picker and the server can never
 * disagree (GAP-FINANCE-BUDGET-FORMULATION-NEW-02).
 *
 * `budget.finance_heads.classification` holds budget-native values
 * (revenue | capital | plan | nonplan, migrations/0001_init.sql) as well as
 * the accounting natures asset | liability | equity | income | expense.
 *
 *  1. An explicit accounting nature asset | liability | equity | income is
 *     never budgetable (and is reported as that type).
 *  2. Otherwise (revenue/capital/plan/nonplan/expense/expenditure or
 *     unclassified) a code starting with a 4-digit Government major head
 *     follows the LMMHA ranges:
 *       0000-1999  receipt heads            -> income,    not budgetable
 *       2000-3999  revenue expenditure      -> expense,   budgetable
 *       4000-5999  capital outlay           -> expense,   budgetable
 *       6000-7999  loans and advances       -> expense,   budgetable
 *       8000-8999  public account           -> liability, not budgetable
 *  3. Any other code (non-numeric, 9xxx, ...) is budgetable (expense).
 */
export type HeadNature = "asset" | "liability" | "equity" | "income" | "expense";

export type BudgetHeadClass = { type: HeadNature; budgetable: boolean };

const EXPLICIT_NON_EXPENSE: ReadonlySet<string> = new Set(["asset", "liability", "equity", "income"]);

export function classifyBudgetHead(head: { classification?: string | null; code?: string | null }): BudgetHeadClass {
  const c = (head.classification ?? "").trim().toLowerCase();
  if (EXPLICIT_NON_EXPENSE.has(c)) return { type: c as HeadNature, budgetable: false };
  const m = /^(\d{4})(?!\d)/.exec((head.code ?? "").trim());
  if (m) {
    const major = Number(m[1]);
    if (major < 2000) return { type: "income", budgetable: false };
    if (major < 8000) return { type: "expense", budgetable: true };
    if (major < 9000) return { type: "liability", budgetable: false };
  }
  return { type: "expense", budgetable: true };
}

export function isBudgetableHead(head: { classification?: string | null; code?: string | null }): boolean {
  return classifyBudgetHead(head).budgetable;
}
