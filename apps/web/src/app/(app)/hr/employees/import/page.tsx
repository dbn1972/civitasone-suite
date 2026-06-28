import { PageHeader, Card } from "../../../../_components/ds";
import { ImportForm } from "./ImportForm";

export default function BulkImportPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bulk Employee Import"
        subtitle="Upload a CSV file to add multiple employees at once. Download the template first to see the required format."
        back="/hr/employees"
        backLabel="Employees"
      />

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>CSV Template</h3>
        <p style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 12 }}>
          Your CSV must have these columns (in this order). Download the template and fill it in.
        </p>
        <table className="tbl" style={{ fontSize: 13, marginBottom: 16 }}>
          <thead>
            <tr><th>Column</th><th>Required</th><th>Example</th></tr>
          </thead>
          <tbody>
            <tr><td>employeeNo</td><td>Yes</td><td>EMP-001</td></tr>
            <tr><td>fullName</td><td>Yes</td><td>Ravi Kumar</td></tr>
            <tr><td>email</td><td>No</td><td>ravi@office.gov.in</td></tr>
            <tr><td>mobile</td><td>No</td><td>9876543210</td></tr>
            <tr><td>departmentCode</td><td>Yes</td><td>FIN</td></tr>
            <tr><td>designationCode</td><td>Yes</td><td>JC</td></tr>
            <tr><td>employeeType</td><td>Yes</td><td>permanent / contract / intern</td></tr>
            <tr><td>dateOfJoining</td><td>Yes</td><td>2024-01-15</td></tr>
            <tr><td>basicPay</td><td>Yes</td><td>44900 (in rupees)</td></tr>
            <tr><td>gender</td><td>No</td><td>male / female / other</td></tr>
          </tbody>
        </table>
        <a
          href="/api/proxy/v1/hrms/employees/import/template"
          className="btn ghost"
          style={{ marginBottom: 16, display: "inline-block" }}
        >
          ⬇️ Download CSV template
        </a>
      </Card>

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Upload your file</h3>
        <ImportForm />
      </Card>
    </main>
  );
}
