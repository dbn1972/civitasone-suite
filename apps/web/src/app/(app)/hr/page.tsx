import type { NavTile } from "@civitasone/types";
import { PageHeader } from "../../_components/ds";
import { HRHubNavigation } from "./_components/HRHubNavigation";

/** Tiles grouped by category for progressive disclosure. */
export const hrCategories: { title: string; icon: string; tiles: NavTile[] }[] = [
	{
		title: "Core",
		icon: "👥",
		tiles: [
			{ title: "Dashboard", href: "/hr/dashboard", description: "People KPIs and quick navigation" },
			{ title: "Employees", href: "/hr/employees", description: "Workforce directory and profiles" },
			{ title: "Directory", href: "/hr/directory", description: "Search by name, dept, or designation" },
			{ title: "Org Chart", href: "/hr/orgchart", description: "Reporting hierarchy" },
		],
	},
	{
		title: "Attendance & Time",
		icon: "📅",
		tiles: [
			{ title: "Attendance", href: "/hr/attendance", description: "Daily presence records" },
			{ title: "Regularisation", href: "/hr/attendance/regularisation", description: "Correction requests" },
			{ title: "Check-in Log", href: "/hr/checkin-log", description: "Biometric / geo log" },
			{ title: "Shifts", href: "/hr/shifts", description: "Shift definitions and rosters" },
			{ title: "Shift Requests", href: "/hr/shift-requests", description: "Swap and change requests" },
			{ title: "WFH Requests", href: "/hr/wfh", description: "Work from home approvals" },
			{ title: "Holidays", href: "/hr/holidays", description: "Gazetted and restricted holidays" },
		],
	},
	{
		title: "Leave",
		icon: "🌴",
		tiles: [
			{ title: "Leave Management", href: "/hr/leave", description: "Review and process requests" },
			{ title: "Apply Leave", href: "/hr/leave/apply", description: "Submit a new application" },
			{ title: "Leave Policies", href: "/hr/leave-policies", description: "Rules and quotas" },
		],
	},
	{
		title: "Payroll & Compensation",
		icon: "💰",
		tiles: [
			{ title: "Payroll Runs", href: "/hr/payroll", description: "Monthly salary processing" },
			{ title: "Salary Slips", href: "/hr/payroll/salary-slips", description: "Individual statements" },
			{ title: "Pay Structures", href: "/hr/payroll/structures", description: "Earning/deduction components" },
			{ title: "Pay Matrix", href: "/hr/pay-matrix", description: "7th CPC pay band matrix" },
			{ title: "GPF", href: "/hr/payroll/gpf", description: "General Provident Fund" },
			{ title: "NPS", href: "/hr/payroll/nps", description: "National Pension System" },
			{ title: "Pensioners", href: "/hr/payroll/pensioners", description: "PPO management" },
			{ title: "Form 16", href: "/hr/payroll/form16", description: "Form-16 generation" },
			{ title: "Statutory", href: "/hr/payroll/statutory", description: "PF, ESI, PT deductions" },
			{ title: "DDO Management", href: "/hr/payroll/ddos", description: "Drawing & Disbursing Officers" },
			{ title: "Full & Final", href: "/hr/payroll/fnf", description: "F&F settlements" },
			{ title: "Loans", href: "/hr/payroll/loans", description: "Loan disbursement and recovery" },
		],
	},
	{
		title: "Benefits & Claims",
		icon: "🎁",
		tiles: [
			{ title: "Benefits", href: "/hr/benefits", description: "HRA, LTC, medical enrollment" },
			{ title: "Loans", href: "/hr/loans", description: "Loan applications and EMI" },
			{ title: "Advances", href: "/hr/advances", description: "Salary advance requests" },
			{ title: "Expenses", href: "/hr/expenses", description: "Expense claims" },
			{ title: "Travel / TA-DA", href: "/hr/travel", description: "Travel allowance claims" },
		],
	},
	{
		title: "Recruitment & Onboarding",
		icon: "📢",
		tiles: [
			{ title: "Recruitment", href: "/hr/recruitment", description: "Job openings and applications" },
			{ title: "Onboarding", href: "/hr/onboarding", description: "New joinee setup" },
		],
	},
	{
		title: "Performance & Development",
		icon: "⭐",
		tiles: [
			{ title: "Appraisals (APAR)", href: "/hr/appraisals", description: "Performance review" },
			{ title: "Goals / KRA", href: "/hr/goals", description: "Targets and tracking" },
			{ title: "Training", href: "/hr/training", description: "Programs and capacity building" },
			{ title: "Skills", href: "/hr/skills", description: "Skill matrix" },
			{ title: "Certifications", href: "/hr/certifications", description: "Certification tracker" },
		],
	},
	{
		title: "Employee Lifecycle",
		icon: "🔄",
		tiles: [
			{ title: "Service Book", href: "/hr/service-book", description: "Postings, promotions history" },
			{ title: "Transfer", href: "/hr/transfer", description: "Transfer orders" },
			{ title: "Promotion", href: "/hr/promotion", description: "Promotion orders" },
			{ title: "Deputation", href: "/hr/deputation", description: "Deputation to other orgs" },
			{ title: "Confirmation", href: "/hr/confirmation", description: "Probation confirmations" },
			{ title: "Retirement", href: "/hr/retirement", description: "Superannuation and separation" },
		],
	},
	{
		title: "Employee Relations",
		icon: "🤝",
		tiles: [
			{ title: "Grievance", href: "/hr/grievance", description: "Grievance redressal" },
			{ title: "Vigilance", href: "/hr/vigilance", description: "Disciplinary cases" },
		],
	},
	{
		title: "Workforce Planning",
		icon: "📋",
		tiles: [
			{ title: "Staffing Plan", href: "/hr/staffing-plan", description: "Sanctioned posts and vacancies" },
			{ title: "Contractual", href: "/hr/contractual", description: "Contractual employees" },
			{ title: "Outsourced", href: "/hr/outsourced", description: "Vendor-supplied workforce" },
			{ title: "Interns", href: "/hr/interns", description: "Interns and apprentices" },
		],
	},
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Human Resources" subtitle="People operations — employees, leave, attendance, payroll, and more." help="hr" />
			<HRHubNavigation categories={hrCategories} />
		</main>
	);
}
