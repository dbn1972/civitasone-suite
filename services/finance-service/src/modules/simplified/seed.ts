/**
 * Simplified Chart of Accounts seed data for MSME / Small Office tenants.
 *
 * This flat chart maps directly to standard double-entry categories but hides
 * all GL/HoA jargon from the user. The codes are stable across all MSME tenants.
 */

export interface SimplifiedAccountSeed {
  code: string;
  name: string;
  category: "income" | "expense" | "asset" | "liability";
  parentCode: string | null;
  isGroup: boolean;
}

export const MSME_CHART_OF_ACCOUNTS: SimplifiedAccountSeed[] = [
  // Income group
  { code: "4000", name: "Income",             category: "income",    parentCode: null,   isGroup: true },
  { code: "4001", name: "Sales Income",       category: "income",    parentCode: "4000", isGroup: false },
  { code: "4002", name: "Service Income",     category: "income",    parentCode: "4000", isGroup: false },
  { code: "4003", name: "Other Income",       category: "income",    parentCode: "4000", isGroup: false },

  // Expense group
  { code: "5000", name: "Expense",                    category: "expense",   parentCode: null,   isGroup: true },
  { code: "5001", name: "Purchase / Cost of Goods",   category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5002", name: "Salary & Wages",             category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5003", name: "Rent",                       category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5004", name: "Utilities",                  category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5005", name: "Transport",                  category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5006", name: "Office Supplies",            category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5007", name: "Marketing",                  category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5008", name: "Professional Fees",          category: "expense",   parentCode: "5000", isGroup: false },
  { code: "5009", name: "Other Expense",              category: "expense",   parentCode: "5000", isGroup: false },

  // Asset group
  { code: "1000", name: "Asset",               category: "asset",     parentCode: null,   isGroup: true },
  { code: "1001", name: "Cash & Bank",         category: "asset",     parentCode: "1000", isGroup: false },
  { code: "1002", name: "Accounts Receivable", category: "asset",     parentCode: "1000", isGroup: false },
  { code: "1003", name: "Inventory",           category: "asset",     parentCode: "1000", isGroup: false },
  { code: "1004", name: "Fixed Assets",        category: "asset",     parentCode: "1000", isGroup: false },

  // Liability group
  { code: "2000", name: "Liability",         category: "liability", parentCode: null,   isGroup: true },
  { code: "2001", name: "Accounts Payable",  category: "liability", parentCode: "2000", isGroup: false },
  { code: "2002", name: "GST Payable",       category: "liability", parentCode: "2000", isGroup: false },
  { code: "2003", name: "TDS Payable",       category: "liability", parentCode: "2000", isGroup: false },
  { code: "2004", name: "Loan",              category: "liability", parentCode: "2000", isGroup: false },
];

/** Maps expense category (user-facing label) to an account code. */
export const EXPENSE_CATEGORY_MAP: Record<string, string> = {
  purchase:          "5001",
  cogs:              "5001",
  salary:            "5002",
  wages:             "5002",
  rent:              "5003",
  utilities:         "5004",
  transport:         "5005",
  office_supplies:   "5006",
  marketing:         "5007",
  professional_fees: "5008",
  other:             "5009",
};
