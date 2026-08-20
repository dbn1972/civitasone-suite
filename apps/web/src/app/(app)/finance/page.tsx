import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const financeSections: NavTile[] = [
	// Existing
	{ title: "Dashboard", description: "Key finance KPIs and quick navigation.", href: "/finance/dashboard" },
	{ title: "Chart of Accounts", description: "Hierarchical account tree with status and balance visibility.", href: "/finance/chart-of-accounts" },

	// Budget
	{ title: "Budget Formulation", section: "Budget", description: "Sanctioned, released, and utilisation by major head.", href: "/finance/budget/formulation" },
	{ title: "Sanctions", section: "Budget", description: "Government expenditure sanctions and approval status.", href: "/finance/budget/sanctions" },
	{ title: "Demand for Grants", section: "Budget", description: "Parliamentary demand for grants with voted/charged breakup.", href: "/finance/budget/demand-grants" },
	{ title: "Revised Estimates", section: "Budget", description: "BE vs RE with variance analysis by head.", href: "/finance/budget/revised-estimates" },
	{ title: "Outcome Budget", section: "Budget", description: "Scheme output indicators and achievement tracking.", href: "/finance/budget/outcome-budget" },
	{ title: "Budget Allocation", section: "Budget", description: "Department-wise allocation, release, and utilization.", href: "/finance/budget/allocation" },

	// Expenditure
	{ title: "Bill Processing", section: "Expenditure", description: "Vendor bills with 3-way match and payment lifecycle.", href: "/finance/expenditure/bills" },
	{ title: "Advances", section: "Expenditure", description: "Employee and vendor advances with outstanding balance tracking.", href: "/finance/expenditure/advances" },
	{ title: "Utilization Certificates", section: "Expenditure", description: "Grant utilization certificates submitted by grantees.", href: "/finance/expenditure/utilization-certificates" },
	{ title: "Guarantees", section: "Expenditure", description: "Bank guarantees, performance securities, and EMDs.", href: "/finance/expenditure/guarantees" },
	{ title: "Scheme Tracking", section: "Expenditure", description: "Scheme expenditure with milestones and UC status.", href: "/finance/expenditure/scheme-tracking" },

	// Treasury & Banking
	{ title: "PFMS Integration", section: "Treasury & Banking", description: "PFMS payment scroll tracking and beneficiary verification.", href: "/finance/treasury/pfms" },
	{ title: "e-Payment Orders", section: "Treasury & Banking", description: "Electronic payment orders with bank references.", href: "/finance/treasury/e-payments" },
	{ title: "Cheque Register", section: "Treasury & Banking", description: "Cheque/DD register with clearance tracking.", href: "/finance/treasury/cheques" },
	{ title: "Fixed Deposits", section: "Treasury & Banking", description: "Fixed and term deposits across treasury banks.", href: "/finance/treasury/deposits" },
	{ title: "Cash & Bank Book", section: "Treasury & Banking", description: "Day book with receipts, payments, and balance.", href: "/finance/treasury/cash-bank" },

	// Revenue & Receipts
	{ title: "Challan Register", section: "Revenue & Receipts", description: "Government challans with deposit verification.", href: "/finance/revenue/challans" },

	// Accounting
	{ title: "General Ledger", section: "Accounting", description: "All posted journal entries with debit and credit detail.", href: "/finance/accounting/general-ledger" },
	{ title: "Recurring Entries", section: "Accounting", description: "Recurring journal templates and schedules.", href: "/finance/recurring-entries" },
	{ title: "Opening Balances", section: "Accounting", description: "Set fiscal-year opening balances (balanced entry).", href: "/finance/opening-balances" },
	{ title: "Fiscal Years", section: "Accounting", description: "Fiscal year setup and activation.", href: "/finance/fiscal-years" },
	{ title: "New Voucher", section: "Accounting", description: "Draft and submit a double-entry journal voucher.", href: "/finance/accounting/vouchers/new" },
	{ title: "Financial Statements", section: "Accounting", description: "Receipts, payments, and balance sheet summary.", href: "/finance/accounting/financial-statements" },
	{ title: "Period Close", section: "Accounting", description: "Soft-close, hard-close, and reopen accounting periods.", href: "/finance/period-close" },
	{ title: "Payments", section: "Accounting", description: "Track outgoing and incoming payments with approvals.", href: "/finance/payments" },

	// Audit & Compliance
	{ title: "Audit Paras", section: "Audit & Compliance", description: "CAG audit observations and department responses.", href: "/finance/audit-paras" },
	{ title: "Debt Management", section: "Audit & Compliance", description: "Loans, EMI schedules, and lender-wise debt.", href: "/finance/debt" },

	// Vendor & Masters
	{ title: "Vendors", section: "Vendor & Masters", description: "Registered vendor master with PAN and GSTIN.", href: "/finance/vendors" },

	// Statutory
	{ title: "TDS Returns", section: "Statutory", description: "Quarterly TDS filing and Form 16A issuance.", href: "/finance/statutory/tds-returns" },
	{ title: "GST & ITC", section: "Statutory", description: "GST summary, ledger, and input-tax-credit reconciliation.", href: "/finance/gst" },
	{ title: "Reconciliation", section: "Statutory", description: "Bank/subledger reconciliation runs and break resolution.", href: "/finance/reconciliation" },
	{ title: "PFMS Operations", section: "Statutory", description: "PFMS batches, salary bills, payment advice, bank file and e-sign.", href: "/finance/pfms" },
];

export default async function Page() {
	const t = await getTranslations("finance");
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title={t("title")} subtitle="Ledgers, budgets, expenditure, treasury, revenue, and statutory reporting." help="finance" />
			<LinkTiles tiles={financeSections} columns="four" />
		</main>
	);
}
