import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { EditEmployeeToggle } from "./EditEmployeeToggle";

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: employee, source } = await getEmployeeById(params.id);

  if (!employee) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Employee Profile" back="/hr/employees" />
        <DataSourceBadge source={source} />
        <Card padding>
          <p className="text-center text-slate-400">Employee not found.</p>
        </Card>
      </main>
    );
  }

  const isActive = employee.status?.toLowerCase() === "active" || employee.status?.toLowerCase() === "probation";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={employee.name}
        back="/hr/employees"
        actions={<EditEmployeeToggle employee={employee} />}
      />
      <DataSourceBadge source={source} />

      {/* Quick Actions — contextual things you can do for this employee */}
      {isActive && (
        <Card title="Quick Actions" padding>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link href={`/hr/leave/apply?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              🌴 Apply Leave
            </Link>
            <Link href={`/hr/payroll/salary-slips?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              🧾 Salary Slips
            </Link>
            <Link href={`/hr/transfer?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              🔄 Initiate Transfer
            </Link>
            <Link href={`/hr/promotion?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              ⬆️ Initiate Promotion
            </Link>
            <Link href={`/hr/attendance?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              📅 View Attendance
            </Link>
            <Link href={`/hr/service-book?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              📖 Service Book
            </Link>
          </div>
        </Card>
      )}

      <Card title="Personal Information" padding>
        <div className="fields">
          <div className="fld">
            <span className="l">Employee ID</span>
            <span className="v">{employee.employeeId}</span>
          </div>
          <div className="fld">
            <span className="l">Department</span>
            <span className="v">{employee.department}</span>
          </div>
          <div className="fld">
            <span className="l">Designation</span>
            <span className="v">{employee.designation}</span>
          </div>
          {employee.grade && (
            <div className="fld">
              <span className="l">Grade</span>
              <span className="v">{employee.grade}</span>
            </div>
          )}
          <div className="fld">
            <span className="l">Joining Date</span>
            <span className="v">{formatIndianDate(employee.joiningDate)}</span>
          </div>
          <div className="fld">
            <span className="l">Status</span>
            <span className="v"><StatusPill status={employee.status} label={employee.status ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1) : "—"} /></span>
          </div>
          {employee.postingLocation && (
            <div className="fld">
              <span className="l">Posting Location</span>
              <span className="v">{employee.postingLocation}</span>
            </div>
          )}
          {employee.reportingTo && (
            <div className="fld">
              <span className="l">Reports To</span>
              <span className="v">{employee.reportingTo}</span>
            </div>
          )}
          {employee.email && (
            <div className="fld">
              <span className="l">Email</span>
              <span className="v">{employee.email}</span>
            </div>
          )}
          {employee.phone && (
            <div className="fld">
              <span className="l">Phone</span>
              <span className="v">{employee.phone}</span>
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
