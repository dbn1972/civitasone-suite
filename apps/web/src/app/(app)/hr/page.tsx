import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const hrTiles: NavTile[] = [
	{ title: "Dashboard", href: "/hr/dashboard", description: "People KPIs and quick navigation" },
	{ title: "Employees", href: "/hr/employees", description: "Workforce directory and profiles" },
	{ title: "Attendance", href: "/hr/attendance", description: "Daily presence and punctuality records" },
	{ title: "Attendance Regularisation", href: "/hr/attendance/regularisation", description: "Correction requests for attendance records" },
	{ title: "Leave Management", href: "/hr/leave", description: "Review and process leave requests" },
	{ title: "Apply Leave", href: "/hr/leave/apply", description: "Submit a new leave application" },
	{ title: "Payroll Runs", href: "/hr/payroll", description: "Monthly salary processing and status" },
	{ title: "Salary Slips", href: "/hr/payroll/salary-slips", description: "Individual employee salary statements" },
	{ title: "Recruitment", href: "/hr/recruitment", description: "Job openings and application pipeline" },
	{ title: "Appraisals", href: "/hr/appraisals", description: "Performance review cycle management" },
	{ title: "Training Programs", href: "/hr/training", description: "Capacity building and skill development" },
	{ title: "Org Chart", href: "/hr/orgchart", description: "Reporting hierarchy across departments" },
];

export default function Page() {
	return (
		<>
			<PageHeader title="Human Resources" subtitle="People operations — employees, leave, attendance, payroll, and more." />
			<LinkTiles tiles={hrTiles} columns="four" />
		</>
	);
}
