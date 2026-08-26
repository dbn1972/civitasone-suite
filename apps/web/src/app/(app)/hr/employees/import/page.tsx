import { PageHeader, Card } from "../../../../_components/ds";
import { ImportForm } from "./ImportForm";

// No backend template-generation route exists (GET .../import/template 404s
// — confirmed live and matches the "no /import route anywhere" finding in
// ImportForm.tsx). The template is static and small, so it's generated here
// as a data: URI instead of linking to a route that was never built.
const TEMPLATE_CSV =
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

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
          href={TEMPLATE_HREF}
          download="employee-import-template.csv"
          className="btn ghost"
          style={{ marginBottom: 16, display: "inline-block" }}
        >
          ⬇️ Download CSV template
        </a>
        <p style={{ color: "var(--mut)", fontSize: 12.5, marginTop: -8, marginBottom: 16 }}>
          Department and designation codes must match exactly what&apos;s configured on the{" "}
          <a href="/hr/departments" style={{ color: "inherit", textDecoration: "underline" }}>Departments</a> and{" "}
          <a href="/hr/designations" style={{ color: "inherit", textDecoration: "underline" }}>Designations</a> pages.
        </p>
      </Card>

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Upload your file</h3>
        <ImportForm />
      </Card>
    </main>
  );
}
