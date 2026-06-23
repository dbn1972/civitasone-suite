import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill } from "../../../../_components/ds";
import { getEmployeeById } from "../../../../_data/loaders";

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: employee, source } = await getEmployeeById(params.id);

  if (!employee) {
    return (
      <>
        <PageHeader title="Employee Profile" back="/hr/employees" />
        {source === "error" && <DataSourceBadge source="error" />}
        <Card padding>
          <p className="text-center text-slate-400">Employee not found.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={employee.name} back="/hr/employees" />
      {source === "error" && <DataSourceBadge source="error" />}
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
    </>
  );
}
