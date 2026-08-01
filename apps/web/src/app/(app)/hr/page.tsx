import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const hrTiles: NavTile[] = [
	// Core
	{ title: "Dashboard", href: "/hr/dashboard", description: "People KPIs and quick navigation" },
	{ title: "Employees", href: "/hr/employees", description: "Workforce directory and profiles" },
	{ title: "Directory", href: "/hr/directory", description: "Search employees by name, dept, or designation" },
	{ title: "Org Chart", href: "/hr/orgchart", description: "Reporting hierarchy across departments" },
	// Attendance & Time
	{ title: "Attendance", href: "/hr/attendance", description: "Daily presence and punctuality records" },
	{ title: "Regularisation", href: "/hr/attendance/regularisation", description: "Correction requests for attendance" },
	{ title: "Check-in Log", href: "/hr/checkin-log", description: "Biometric / geo attendance log" },
	{ title: "Shifts", href: "/hr/shifts", description: "Shift definitions and rosters" },
	{ title: "Shift Requests", href: "/hr/shift-requests", description: "Shift swap and change requests" },
	{ title: "WFH Requests", href: "/hr/wfh", description: "Work from home approvals" },
	{ title: "Holidays", href: "/hr/holidays", description: "Gazetted and restricted holiday calendar" },
	// Leave
	{ title: "Leave Management", href: "/hr/leave", description: "Review and process leave requests" },
	{ title: "Apply Leave", href: "/hr/leave/apply", description: "Submit a new leave application" },
	{ title: "Leave Policies", href: "/hr/leave-policies", description: "Leave type rules and quotas" },
	// Payroll
	{ title: "Payroll Runs", href: "/hr/payroll", description: "Monthly salary processing and status" },
	{ title: "Salary Slips", href: "/hr/payroll/salary-slips", description: "Individual salary statements" },
	{ title: "Pay Structures", href: "/hr/payroll/structures", description: "Earning/deduction component structures" },
	{ title: "CTC Configuration", href: "/hr/payroll/ctc", description: "CTC component rules and calculator" },
	{ title: "Pay Groups", href: "/hr/payroll/pay-groups", description: "Employee pay-schedule groups" },
	{ title: "Salary Structure", href: "/hr/salary-structure", description: "Grade-wise component breakdowns" },
	{ title: "Pay Matrix", href: "/hr/pay-matrix", description: "7th CPC pay band matrix" },
	{ title: "GPF", href: "/hr/payroll/gpf", description: "General Provident Fund statements" },
	{ title: "NPS", href: "/hr/payroll/nps", description: "National Pension System contributions" },
	{ title: "Pensioners", href: "/hr/payroll/pensioners", description: "PPO management" },
	{ title: "Tax Declaration", href: "/hr/payroll/tax-declaration", description: "80C/80D/HRA investment proofs" },
	{ title: "Income Tax", href: "/hr/payroll/income-tax", description: "IT computation summary" },
	{ title: "Statutory", href: "/hr/payroll/statutory", description: "PF, ESI, PT deduction breakdown" },
	{ title: "Arrears", href: "/hr/payroll/arrears", description: "Arrears computation and recovery" },
	{ title: "Payroll Period", href: "/hr/payroll/period", description: "Monthly periods and run status" },
	// Compensation & Benefits
	{ title: "Benefits", href: "/hr/benefits", description: "HRA, LTC, medical, conveyance enrollment" },
	{ title: "Loans", href: "/hr/loans", description: "Employee loan applications and EMI" },
	{ title: "Advances", href: "/hr/advances", description: "Salary advance requests and recovery" },
	{ title: "Expenses", href: "/hr/expenses", description: "Expense claims and reimbursements" },
	{ title: "Travel / TA-DA", href: "/hr/travel", description: "Travel requests and allowance claims" },
	// Recruitment & Onboarding
	{ title: "Recruitment", href: "/hr/recruitment", description: "Job openings and applications" },
	{ title: "Onboarding", href: "/hr/onboarding", description: "New joinee setup checklist" },
	// Performance
	{ title: "Appraisals (APAR)", href: "/hr/appraisals", description: "Performance review cycle" },
	{ title: "Goals / KRA", href: "/hr/goals", description: "Targets, KRAs, and achievement tracking" },
	{ title: "Work Summary", href: "/hr/work-summary", description: "Weekly/monthly work reports" },
	// Training & Skills
	{ title: "Training", href: "/hr/training", description: "Programs and capacity building" },
	{ title: "Certifications", href: "/hr/certifications", description: "Employee certification tracker" },
	{ title: "Skills", href: "/hr/skills", description: "Skill matrix and competency map" },
	// Employee Lifecycle
	{ title: "Service Book", href: "/hr/service-book", description: "Postings, promotions, transfers history" },
	{ title: "Transfer", href: "/hr/transfer", description: "Transfer orders and postings" },
	{ title: "Promotion", href: "/hr/promotion", description: "Promotion orders and grade changes" },
	{ title: "Deputation", href: "/hr/deputation", description: "Deputation to other organizations" },
	{ title: "Confirmation", href: "/hr/confirmation", description: "Probation period confirmations" },
	{ title: "Retirement", href: "/hr/retirement", description: "Superannuation and separation" },
	// Employee Relations
	{ title: "Grievance", href: "/hr/grievance", description: "Grievance redressal cases" },
	{ title: "Vigilance", href: "/hr/vigilance", description: "Disciplinary and vigilance cases" },
	// Workforce Planning
	{ title: "Staffing Plan", href: "/hr/staffing-plan", description: "Sanctioned posts and vacancies" },
	{ title: "Contractual", href: "/hr/contractual", description: "Contractual employee management" },
	{ title: "Outsourced", href: "/hr/outsourced", description: "Vendor-supplied workforce" },
	{ title: "Interns", href: "/hr/interns", description: "Interns and apprentices" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Human Resources" subtitle="People operations — employees, leave, attendance, payroll, and more." help="hr" />
			<LinkTiles tiles={hrTiles} columns="four" />
		</main>
	);
}
