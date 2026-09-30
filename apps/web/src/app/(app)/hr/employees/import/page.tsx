import { PageHeader, Card } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { ImportForm } from "./ImportForm";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// No backend template-generation route exists (GET .../import/template 404s
// — confirmed live and matches the "no /import route anywhere" finding in
// ImportForm.tsx). The template is static and small, so it's generated here
// as a data: URI instead of linking to a route that was never built.
const TEMPLATE_CSV =
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender,managerEmployeeNo\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male,\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

/**
 * GAP-HR-EMPLOYEES-IMPORT-01: this comment used to claim it mirrored
 * POST /v1/hrms/employees's HR_ROLES -- stale even before this fix
 * (ImportForm.tsx has posted to the dedicated POST /v1/hrms/employees/bulk
 * endpoint since GAP-HR-EMPLOYEES-IMPORT-02's fix, not the single-row
 * route). That bulk endpoint's own HR_ROLES (bulk-import/routes.ts) is
 * ["hr_admin","super_admin","admin"] -- excludes hr_officer. Per the
 * published decision packet's grouped card for this exact mismatch
 * ("hr_officer... bulk employee import [up to 500 rows at once]... Leave
 * all four hr_admin-tier for now... and just fix the dead-end UI to say so
 * plainly instead of failing silently"), this list is narrowed to match
 * the backend -- not widened -- so hr_officer now gets an honest
 * PermissionDenied here instead of a working-looking upload that 403s on
 * every single row.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "super_admin"];

export default async function BulkImportPage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="bulk-importing employees" requiredRoles={EMPLOYEE_ADMIN_ROLES} />;
  }

  const t = await getTranslations("employeeImport");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/employees"
        backLabel={t("backLabel")}
      />

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{t("csvTemplateHeading")}</h3>
        <p style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 12 }}>
          {t("csvInstructions")}
        </p>
        {/* GAP-HR-EMPLOYEES-IMPORT-07: no responsive wrapper -- this table
            (10 rows x 3 columns) overflowed the viewport at narrow widths
            with no way to scroll it independently of the page. */}
        <div style={{ overflowX: "auto", marginBottom: 16 }}>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead>
              <tr><th>{t("thColumn")}</th><th>{t("thRequired")}</th><th>{t("thExample")}</th></tr>
            </thead>
            <tbody>
              <tr><td>{t("colEmployeeNo")}</td><td>{t("yes")}</td><td>{t("exEmployeeNo")}</td></tr>
              <tr><td>{t("colFullName")}</td><td>{t("yes")}</td><td>{t("exFullName")}</td></tr>
              <tr><td>{t("colEmail")}</td><td>{t("no")}</td><td>{t("exEmail")}</td></tr>
              <tr><td>{t("colMobile")}</td><td>{t("no")}</td><td>{t("exMobile")}</td></tr>
              <tr><td>{t("colDepartmentCode")}</td><td>{t("yes")}</td><td>{t("exDepartmentCode")}</td></tr>
              <tr><td>{t("colDesignationCode")}</td><td>{t("yes")}</td><td>{t("exDesignationCode")}</td></tr>
              <tr><td>{t("colEmployeeType")}</td><td>{t("yes")}</td><td>{t("exEmployeeType")}</td></tr>
              <tr><td>{t("colDateOfJoining")}</td><td>{t("yes")}</td><td>{t("exDateOfJoining")}</td></tr>
              <tr><td>{t("colBasicPay")}</td><td>{t("yes")}</td><td>{t("exBasicPay")}</td></tr>
              <tr><td>{t("colGender")}</td><td>{t("no")}</td><td>{t("exGender")}</td></tr>
              {/* GAP-HR-EMPLOYEES-IMPORT-05 */}
              <tr><td>{t("colManagerEmployeeNo")}</td><td>{t("no")}</td><td>{t("exManagerEmployeeNo")}</td></tr>
            </tbody>
          </table>
        </div>
        <a
          href={TEMPLATE_HREF}
          download="employee-import-template.csv"
          className="btn ghost"
          style={{ marginBottom: 16, display: "inline-block" }}
        >
          {t("downloadTemplate")}
        </a>
        <p style={{ color: "var(--mut)", fontSize: 12.5, marginTop: -8, marginBottom: 16 }}>
          {t.rich("codesNoteRich", {
            deptLink: (chunks) => <a href="/hr/departments" style={{ color: "inherit", textDecoration: "underline" }}>{chunks}</a>,
            desigLink: (chunks) => <a href="/hr/designations" style={{ color: "inherit", textDecoration: "underline" }}>{chunks}</a>,
          })}
        </p>
        {/* GAP-HR-EMPLOYEES-IMPORT-04: the employeeType example ("permanent
            / contract / intern") mixes legacy codes with no link to where a
            tenant's own valid codes are actually configured/confirmed. */}
        <p style={{ color: "var(--mut)", fontSize: 12.5, marginTop: -8, marginBottom: 16 }}>
          {t.rich("employeeTypeNoteRich", {
            typeLink: (chunks) => <a href="/hr/employee-types" style={{ color: "inherit", textDecoration: "underline" }}>{chunks}</a>,
          })}
        </p>
      </Card>

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{t("uploadHeading")}</h3>
        <ImportForm />
      </Card>
    </div>
  );
}
