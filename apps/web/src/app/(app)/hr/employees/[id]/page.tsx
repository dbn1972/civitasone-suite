import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";
import { EditEmployeeToggle } from "./EditEmployeeToggle";

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: employee, source } = await getEmployeeById(params.id);

  if (!employee) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <PageHeader title="Employee Profile" back="/hr/employees" />
        {source === "error" && (
          <div aria-live="assertive" aria-atomic="true">
            <DataSourceBadge source="error" />
          </div>
        )}
        <Card padding>
          <p className="text-center text-slate-400">Employee not found.</p>
        </Card>
      </main>
    );
  }

  const isActive = employee.status?.toLowerCase() === "active" || employee.status?.toLowerCase() === "probation";

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title={employee.name}
        back="/hr/employees"
        actions={<EditEmployeeToggle employee={employee} />}
      />
      {source === "error" && (
        <div aria-live="assertive" aria-atomic="true">
          <DataSourceBadge source="error" />
        </div>
      )}

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
            <Link href="/hr/transfer" className="btn ghost" style={{ fontSize: 13 }}>
              🔄 Initiate Transfer
            </Link>
            <Link href="/hr/promotion" className="btn ghost" style={{ fontSize: 13 }}>
              ⬆️ Initiate Promotion
            </Link>
            <Link href={`/hr/attendance?empId=${params.id}`} className="btn ghost" style={{ fontSize: 13 }}>
              📅 View Attendance
            </Link>
            <Link href="/hr/service-book" className="btn ghost" style={{ fontSize: 13 }}>
              📖 Service Book
            </Link>
          </div>
        </Card>
      )}

      <Card title="Personal Information" padding>
        <div className="fields">
          <div className="field">
            <span className="lbl">Employee ID</span>
            <span className="val">{employee.employeeId}</span>
          </div>
          <div className="field">
            <span className="lbl">Department</span>
            <span className="val">{employee.department}</span>
          </div>
          <div className="field">
            <span className="lbl">Designation</span>
            <span className="val">{employee.designation}</span>
          </div>
          {employee.grade && (
            <div className="field">
              <span className="lbl">Grade</span>
              <span className="val">{employee.grade}</span>
            </div>
          )}
          <div className="field">
            <span className="lbl">Joining Date</span>
            <span className="val">{employee.joiningDate}</span>
          </div>
          <div className="field">
            <span className="lbl">Status</span>
            <span className="val"><StatusPill status={employee.status} /></span>
          </div>
          {employee.postingLocation && (
            <div className="field">
              <span className="lbl">Posting Location</span>
              <span className="val">{employee.postingLocation}</span>
            </div>
          )}
          {employee.reportingTo && (
            <div className="field">
              <span className="lbl">Reports To</span>
              <span className="val">{employee.reportingTo}</span>
            </div>
          )}
          {employee.email && (
            <div className="field">
              <span className="lbl">Email</span>
              <span className="val">{employee.email}</span>
            </div>
          )}
          {employee.phone && (
            <div className="field">
              <span className="lbl">Phone</span>
              <span className="val">{employee.phone}</span>
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
