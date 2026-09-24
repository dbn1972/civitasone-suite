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
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

/**
 * Mirrors services/hrms-service/src/modules/employee/routes.ts's HR_ROLES
 * guard on POST /v1/hrms/employees. ImportForm.tsx posts each imported row
 * to that same create-employee endpoint (there is no separate bulk-import
 * route), so this frontend gate matches it exactly.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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
        <table className="tbl" style={{ fontSize: 13, marginBottom: 16 }}>
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
          </tbody>
        </table>
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
      </Card>

      <Card padding>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{t("uploadHeading")}</h3>
        <ImportForm />
      </Card>
    </div>
  );
}
