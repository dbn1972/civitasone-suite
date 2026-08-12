import type { NavTile } from "@civitasone/types";
import { PageHeader } from "../../_components/ds";
import { HRHubNavigation } from "./_components/HRHubNavigation";

/**
 * Tiles grouped by category for progressive disclosure.
 *
 * Intentionally NOT exported: Next.js App Router validates page module
 * exports and rejects anything outside its allowed set (default export,
 * metadata/generateMetadata, route segment config, etc.). Exporting this
 * broke `next build` with:
 *   Type error: "hrCategories" is not a valid Page export field.
 * Nothing outside this file consumes it, so a module-local const is correct.
 */
const hrCategories: { title: string; icon: string; tiles: NavTile[] }[] = [
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
			{ title: "Overtime", href: "/hr/overtime", description: "Overtime requests and approvals" },
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
			{ title: "Salary Structures", href: "/hr/salary-structure", description: "Pay structure component definitions" },
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
			{ title: "Medical Claims", href: "/hr/medical", description: "CGHS / CS(MA) reimbursement" },
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
			{ title: "Appraisals (APAR)", href: "/hr/apar", description: "SPARROW multi-authority appraisal workflow" },
			{ title: "Goals / KRA", href: "/hr/goals", description: "Targets and tracking" },
			{ title: "Training", href: "/hr/training", description: "Programs and capacity building" },
			{ title: "Skills", href: "/hr/skills", description: "Skill matrix" },
			{ title: "Certifications", href: "/hr/certifications", description: "Certification tracker" },
			{ title: "Competency Framework", href: "/hr/competency", description: "Competencies and frameworks" },
			{ title: "Work Summaries", href: "/hr/work-summary", description: "Employee task and performance records" },
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
			{ title: "DPC Eligibility", href: "/hr/dpc", description: "Promotion seniority list" },
		],
	},
	{
		title: "Employee Relations",
		icon: "🤝",
		tiles: [
			{ title: "Grievance", href: "/hr/grievance", description: "Grievance redressal" },
			{ title: "Vigilance", href: "/hr/vigilance", description: "Disciplinary cases" },
			{ title: "Disciplinary Cases", href: "/hr/disciplinary", description: "All proceedings — major & minor" },
			{ title: "ICC Complaints (POSH)", href: "/hr/icc", description: "Internal complaints under POSH Act" },
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
			{ title: "Workforce Analytics", href: "/hr/workforce", description: "Headcount and retirement forecast" },
			{ title: "Succession Planning", href: "/hr/succession", description: "Critical role coverage" },
		],
	},
	{
		title: "Compliance & Transparency",
		icon: "⚖️",
		tiles: [
			{ title: "RTI Requests", href: "/hr/rti", description: "Right to Information tracking" },
		],
	},
	{
		title: "Setup & Configuration",
		icon: "⚙️",
		tiles: [
			{ title: "Departments", href: "/hr/departments", description: "Add and manage departments" },
			{ title: "Designations", href: "/hr/designations", description: "Job titles and pay levels" },
			{ title: "Locations", href: "/hr/locations", description: "Office and facility locations" },
      { title: "Leave Policies", href: "/hr/leave-policies", description: "Leave rules and entitlements" },
			{ title: "Holidays", href: "/hr/holidays", description: "Gazetted and restricted holidays" },
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
