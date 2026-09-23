import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

export default async function Page() {
	const t = await getTranslations("hr");

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
			title: t("catCore"),
			icon: "👥",
			tiles: [
				{ title: t("dashboard"), href: "/hr/dashboard", description: t("dashboardDesc") },
				{ title: t("employees"), href: "/hr/employees", description: t("employeesDesc") },
				{ title: t("directory"), href: "/hr/directory", description: t("directoryDesc") },
				{ title: t("orgChart"), href: "/hr/org-chart", description: t("orgChartDesc") },
				{ title: t("idCards"), href: "/hr/id-cards", description: t("idCardsDesc") },
			],
		},
		{
			title: t("catAttendanceTime"),
			icon: "📅",
			tiles: [
				{ title: t("attendance"), href: "/hr/attendance", description: t("attendanceDesc") },
				{ title: t("regularisation"), href: "/hr/attendance/regularisation", description: t("regularisationDesc") },
				{ title: t("checkinLog"), href: "/hr/checkin-log", description: t("checkinLogDesc") },
				{ title: t("shifts"), href: "/hr/shifts", description: t("shiftsDesc") },
				{ title: t("shiftRequests"), href: "/hr/shift-requests", description: t("shiftRequestsDesc") },
				{ title: t("wfhRequests"), href: "/hr/wfh", description: t("wfhRequestsDesc") },
				{ title: t("holidays"), href: "/hr/holidays", description: t("holidaysDesc") },
			],
		},
		{
			title: t("catLeave"),
			icon: "🌴",
			tiles: [
				{ title: t("leaveManagement"), href: "/hr/leave", description: t("leaveManagementDesc") },
				{ title: t("applyLeave"), href: "/hr/leave/apply", description: t("applyLeaveDesc") },
				{ title: t("leavePolicies"), href: "/hr/leave-policies", description: t("leavePoliciesDesc") },
				{ title: t("overtime"), href: "/hr/overtime", description: t("overtimeDesc") },
			],
		},
		{
			title: t("catPayroll"),
			icon: "💰",
			tiles: [
				{ title: t("payrollRuns"), href: "/hr/payroll", description: t("payrollRunsDesc") },
				{ title: t("salarySlips"), href: "/hr/payroll/salary-slips", description: t("salarySlipsDesc") },
				{ title: t("payStructures"), href: "/hr/payroll/structures", description: t("payStructuresDesc") },
				{ title: t("payMatrix"), href: "/hr/pay-matrix", description: t("payMatrixDesc") },
				{ title: t("salaryStructures"), href: "/hr/salary-structure", description: t("salaryStructuresDesc") },
				{ title: t("gpf"), href: "/hr/payroll/gpf", description: t("gpfDesc") },
				{ title: t("nps"), href: "/hr/payroll/nps", description: t("npsDesc") },
				{ title: t("pensioners"), href: "/hr/payroll/pensioners", description: t("pensionersDesc") },
				{ title: t("form16"), href: "/hr/payroll/form16", description: t("form16Desc") },
				{ title: t("statutory"), href: "/hr/payroll/statutory", description: t("statutoryDesc") },
				{ title: t("ddoManagement"), href: "/hr/payroll/ddos", description: t("ddoManagementDesc") },
				{ title: t("fullFinal"), href: "/hr/payroll/fnf", description: t("fullFinalDesc") },
				{ title: t("loans"), href: "/hr/payroll/loans", description: t("loansDesc") },
				{ title: t("offCyclePayroll"), href: "/hr/payroll/off-cycle", description: t("offCyclePayrollDesc") },
				{ title: t("taxDeclaration"), href: "/hr/payroll/tax-declaration", description: t("taxDeclarationDesc") },
				{ title: t("incomeTax"), href: "/hr/payroll/income-tax", description: t("incomeTaxDesc") },
				{ title: t("tdsReturns"), href: "/hr/payroll/returns", description: t("tdsReturnsDesc") },
				{ title: t("taxConfig"), href: "/hr/payroll/tax-config", description: t("taxConfigDesc") },
				{ title: t("salaryRevisions"), href: "/hr/payroll/salary-revisions", description: t("salaryRevisionsDesc") },
				{ title: t("salaryCorrections"), href: "/hr/payroll/corrections", description: t("salaryCorrectionsDesc") },
				{ title: t("arrears"), href: "/hr/payroll/arrears", description: t("arrearsDesc") },
				{ title: t("bonus"), href: "/hr/payroll/bonus", description: t("bonusDesc") },
				{ title: t("reimbursements"), href: "/hr/payroll/reimbursements", description: t("reimbursementsDesc") },
				{ title: t("payGroups"), href: "/hr/payroll/pay-groups", description: t("payGroupsDesc") },
				{ title: t("ctcCalculator"), href: "/hr/payroll/ctc", description: t("ctcCalculatorDesc") },
				{ title: t("flexBenefits"), href: "/hr/payroll/flex-benefits", description: t("flexBenefitsDesc") },
				{ title: t("costing"), href: "/hr/payroll/costing", description: t("costingDesc") },
				{ title: t("payrollRegister"), href: "/hr/payroll/register", description: t("payrollRegisterDesc") },
				{ title: t("comparison"), href: "/hr/payroll/comparison", description: t("comparisonDesc") },
				{ title: t("payrollPeriod"), href: "/hr/payroll/period", description: t("payrollPeriodDesc") },
				{ title: t("disbursement"), href: "/hr/payroll/disbursement", description: t("disbursementDesc") },
			],
		},
		{
			title: t("catBenefits"),
			icon: "🎁",
			tiles: [
				{ title: t("benefits"), href: "/hr/benefits", description: t("benefitsDesc") },
				{ title: t("loansB"), href: "/hr/loans", description: t("loansBDesc") },
				{ title: t("advances"), href: "/hr/advances", description: t("advancesDesc") },
				{ title: t("expenses"), href: "/hr/expenses", description: t("expensesDesc") },
				{ title: t("travel"), href: "/hr/travel", description: t("travelDesc") },
				{ title: t("medicalClaims"), href: "/hr/medical", description: t("medicalClaimsDesc") },
			],
		},
		{
			title: t("catRecruitment"),
			icon: "📢",
			tiles: [
				{ title: t("recruitment"), href: "/hr/recruitment", description: t("recruitmentDesc") },
				{ title: t("onboarding"), href: "/hr/onboarding", description: t("onboardingDesc") },
			],
		},
		{
			title: t("catPerformance"),
			icon: "⭐",
			tiles: [
				{ title: t("appraisals"), href: "/hr/apar", description: t("appraisalsDesc") },
				{ title: t("goals"), href: "/hr/goals", description: t("goalsDesc") },
				{ title: t("training"), href: "/hr/training", description: t("trainingDesc") },
				{ title: t("skills"), href: "/hr/skills", description: t("skillsDesc") },
				{ title: t("certifications"), href: "/hr/certifications", description: t("certificationsDesc") },
				{ title: t("competency"), href: "/hr/competency", description: t("competencyDesc") },
				{ title: t("workSummaries"), href: "/hr/work-summary", description: t("workSummariesDesc") },
			],
		},
		{
			title: t("catLifecycle"),
			icon: "🔄",
			tiles: [
				{ title: t("serviceBook"), href: "/hr/service-book", description: t("serviceBookDesc") },
				{ title: t("transfer"), href: "/hr/transfer", description: t("transferDesc") },
				{ title: t("promotion"), href: "/hr/promotion", description: t("promotionDesc") },
				{ title: t("deputation"), href: "/hr/deputation", description: t("deputationDesc") },
				{ title: t("confirmation"), href: "/hr/confirmation", description: t("confirmationDesc") },
				{ title: t("retirement"), href: "/hr/retirement", description: t("retirementDesc") },
				{ title: t("dpc"), href: "/hr/dpc", description: t("dpcDesc") },
			],
		},
		{
			title: t("catRelations"),
			icon: "🤝",
			tiles: [
				{ title: t("grievance"), href: "/hr/grievance", description: t("grievanceDesc") },
				{ title: t("vigilance"), href: "/hr/vigilance", description: t("vigilanceDesc") },
				{ title: t("disciplinary"), href: "/hr/disciplinary", description: t("disciplinaryDesc") },
				{ title: t("icc"), href: "/hr/icc", description: t("iccDesc") },
			],
		},
		{
			title: t("catWorkforce"),
			icon: "📋",
			tiles: [
				{ title: t("staffingPlan"), href: "/hr/staffing-plan", description: t("staffingPlanDesc") },
				{ title: t("contractual"), href: "/hr/contractual", description: t("contractualDesc") },
				{ title: t("outsourced"), href: "/hr/outsourced", description: t("outsourcedDesc") },
				{ title: t("interns"), href: "/hr/interns", description: t("internsDesc") },
				{ title: t("workforceAnalytics"), href: "/hr/workforce", description: t("workforceAnalyticsDesc") },
				{ title: t("successionPlanning"), href: "/hr/succession", description: t("successionPlanningDesc") },
			],
		},
		{
			title: t("catCompliance"),
			icon: "⚖️",
			tiles: [
				{ title: t("rti"), href: "/hr/rti", description: t("rtiDesc") },
			],
		},
		{
			title: t("catCommunication"),
			icon: "💬",
			tiles: [
				{ title: t("socialFeed"), href: "/hr/social-feed", description: t("socialFeedDesc") },
			],
		},
		{
			title: t("catSetup"),
			icon: "⚙️",
			tiles: [
				{ title: t("departments"), href: "/hr/departments", description: t("departmentsDesc") },
				{ title: t("designations"), href: "/hr/designations", description: t("designationsDesc") },
				{ title: t("locations"), href: "/hr/locations", description: t("locationsDesc") },
				{ title: t("setupLeavePolicies"), href: "/hr/leave-policies", description: t("setupLeavePoliciesDesc") },
				{ title: t("setupHolidays"), href: "/hr/holidays", description: t("setupHolidaysDesc") },
				{ title: t("employeeTypes"), href: "/hr/employee-types", description: t("employeeTypesDesc") },
				{ title: t("auditLog"), href: "/hr/audit-log", description: t("auditLogDesc") },
			],
		},
	];

	return (
		<main className="page-main wrap" aria-labelledby="page-heading">
			<PageHeader
				title={t("title")}
				subtitle={t("subtitle")}
				help="hr"
			/>
			{hrCategories.map((cat) => (
				<section key={cat.title} style={{ marginBottom: 32 }}>
					<h2
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: "var(--ink2)",
							textTransform: "uppercase",
							letterSpacing: "0.07em",
							marginBottom: 12,
							display: "flex",
							alignItems: "center",
							gap: 7,
						}}
					>
						<span aria-hidden="true">{cat.icon}</span>
						{cat.title}
					</h2>
					<LinkTiles tiles={cat.tiles} columns="four" />
				</section>
			))}
		</main>
	);
}
