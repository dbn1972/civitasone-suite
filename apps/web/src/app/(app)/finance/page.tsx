import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const financeSections: NavTile[] = [
	// Existing
	{ title: "Dashboard", description: "Key finance KPIs and quick navigation.", href: "/finance/dashboard" },
	{ title: "Chart of Accounts", description: "Hierarchical account tree with status and balance visibility.", href: "/finance/chart-of-accounts" },

	// Budget
	{ title: "Budget Formulation", description: "Sanctioned, released, and utilisation by major head.", href: "/finance/budget/formulation" },
	{ title: "Sanctions", description: "Government expenditure sanctions and approval status.", href: "/finance/budget/sanctions" },
	{ title: "Demand for Grants", description: "Parliamentary demand for grants with voted/charged breakup.", href: "/finance/budget/demand-grants" },
	{ title: "Revised Estimates", description: "BE vs RE with variance analysis by head.", href: "/finance/budget/revised-estimates" },
	{ title: "Outcome Budget", description: "Scheme output indicators and achievement tracking.", href: "/finance/budget/outcome-budget" },
	{ title: "Budget Allocation", description: "Department-wise allocation, release, and utilization.", href: "/finance/budget/allocation" },
	{ title: "Fund Accounting", description: "Fund-wise receipts, expenditure, and balance.", href: "/finance/budget/fund-accounting" },

	// Expenditure
	{ title: "Bill Processing", description: "Vendor bills with 3-way match and payment lifecycle.", href: "/finance/expenditure/bills" },
	{ title: "Advances", description: "Employee and vendor advances with outstanding balance tracking.", href: "/finance/expenditure/advances" },
	{ title: "Utilization Certificates", description: "Grant utilization certificates submitted by grantees.", href: "/finance/expenditure/utilization-certificates" },
	{ title: "Deductions", description: "Statutory deductions register (TDS, IT, GST).", href: "/finance/expenditure/deductions" },
	{ title: "Payment Advice", description: "Payment advice notes issued to banks.", href: "/finance/expenditure/payment-advice" },
	{ title: "Guarantees", description: "Bank guarantees, performance securities, and EMDs.", href: "/finance/expenditure/guarantees" },
	{ title: "Scheme Tracking", description: "Scheme expenditure with milestones and UC status.", href: "/finance/expenditure/scheme-tracking" },

	// Treasury & Banking
	{ title: "PFMS Integration", description: "PFMS payment scroll tracking and beneficiary verification.", href: "/finance/treasury/pfms" },
	{ title: "RBI / Treasury", description: "Treasury bills, bonds, and term deposit investments.", href: "/finance/treasury/rbi" },
	{ title: "Electronic Fund Transfer", description: "NEFT/RTGS transfers with UTR tracking.", href: "/finance/treasury/eft" },
	{ title: "e-Payment Orders", description: "Electronic payment orders with bank references.", href: "/finance/treasury/e-payments" },
	{ title: "Cheque Register", description: "Cheque/DD register with clearance tracking.", href: "/finance/treasury/cheques" },
	{ title: "Fixed Deposits", description: "Fixed and term deposits across treasury banks.", href: "/finance/treasury/deposits" },
	{ title: "Cash & Bank Book", description: "Day book with receipts, payments, and balance.", href: "/finance/treasury/cash-bank" },

	// Revenue & Receipts
	{ title: "Receipt Vouchers", description: "Revenue receipts with payer and head mapping.", href: "/finance/revenue/receipts" },
	{ title: "Tax & Non-Tax Revenue", description: "Budget vs actual revenue by account head.", href: "/finance/revenue/tax-nontax" },
	{ title: "Fees Collection", description: "Statutory fees and application fee register.", href: "/finance/revenue/fees" },
	{ title: "Challan Register", description: "Government challans with deposit verification.", href: "/finance/revenue/challans" },
	{ title: "DBT Beneficiaries", description: "Direct Benefit Transfer with Aadhaar verification.", href: "/finance/revenue/dbt" },

	// Accounting
	{ title: "General Ledger", description: "All posted journal entries with debit and credit detail.", href: "/finance/accounting/general-ledger" },
	{ title: "New Voucher", description: "Draft and submit a double-entry journal voucher.", href: "/finance/accounting/vouchers/new" },
	{ title: "Financial Statements", description: "Receipts, payments, and balance sheet summary.", href: "/finance/accounting/financial-statements" },
	{ title: "Payments", description: "Track outgoing and incoming payments with approvals.", href: "/finance/payments" },

	// Audit & Compliance
	{ title: "Audit Paras", description: "CAG audit observations and department responses.", href: "/finance/audit-paras" },
	{ title: "Debt Management", description: "Loans, EMI schedules, and lender-wise debt.", href: "/finance/debt" },

	// Vendor & Masters
	{ title: "Vendors", description: "Registered vendor master with PAN and GSTIN.", href: "/finance/vendors" },
	{ title: "Licenses & Fees", description: "Issued licenses, permits, and fee tracking.", href: "/finance/licenses" },

	// Statutory
	{ title: "GeM & e-Invoice", description: "GeM orders and IRN-validated e-invoices.", href: "/finance/statutory/gem-einvoice" },
	{ title: "TDS Returns", description: "Quarterly TDS filing and Form 16A issuance.", href: "/finance/statutory/tds-returns" },
	{ title: "User Charges", description: "Service-wise user charges and fee collections.", href: "/finance/user-charges" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Finance" subtitle="Ledgers, budgets, expenditure, treasury, revenue, and statutory reporting." help="finance" />
			<LinkTiles tiles={financeSections} columns="four" />
		</main>
	);
}
