import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const financeSections: NavTile[] = [
	{ title: "Dashboard", description: "Key finance KPIs and quick navigation.", href: "/finance/dashboard" },
	{ title: "Chart of Accounts", description: "Hierarchical account tree with status and balance visibility.", href: "/finance/chart-of-accounts" },
	{ title: "Budget Formulation", description: "Sanctioned, released, and utilisation by major head.", href: "/finance/budget/formulation" },
	{ title: "Sanctions", description: "Government expenditure sanctions and approval status.", href: "/finance/budget/sanctions" },
	{ title: "Bill Processing", description: "Vendor bills with 3-way match and payment lifecycle.", href: "/finance/expenditure/bills" },
	{ title: "Advances", description: "Employee and vendor advances with outstanding balance tracking.", href: "/finance/expenditure/advances" },
	{ title: "Utilization Certificates", description: "Grant utilization certificates submitted by grantees.", href: "/finance/expenditure/utilization-certificates" },
	{ title: "General Ledger", description: "All posted journal entries with debit and credit detail.", href: "/finance/accounting/general-ledger" },
	{ title: "New Voucher", description: "Draft and submit a double-entry journal voucher.", href: "/finance/accounting/vouchers/new" },
	{ title: "Financial Statements", description: "Receipts, payments, and balance sheet summary.", href: "/finance/accounting/financial-statements" },
	{ title: "Payments", description: "Track outgoing and incoming payments with approvals.", href: "/finance/payments" },
];

export default function Page() {
	return (
		<>
			<PageHeader title="Finance" subtitle="Ledgers, budgets, expenditure, and statutory reporting." />
			<LinkTiles tiles={financeSections} columns="four" />
		</>
	);
}
