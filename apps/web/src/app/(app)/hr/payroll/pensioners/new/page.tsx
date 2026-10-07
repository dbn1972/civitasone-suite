import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "../../../../../../lib/auth/roleGuard";
import { CreatePensionerForm } from "./CreatePensionerForm";

// Gated on the same roles payroll-service enforces for POST
// /v1/payroll/pensioners (PAYROLL_ROLES in payroll/routes.ts) -- shared via
// roleGuard's PAYROLL_ADMIN_ROLES (GAP-PAYROLL-PENSIONERS-05).
//
// GAP-PAYROLL-PENSIONERS-NEW-05: the old try/catch + RefreshErrorState here
// duplicated error.tsx (RouteError with retry) and was practically
// unreachable; failures now go to the route's error boundary only.
// Named page-level constants (PENSIONER_VIEW_ROLES / PENSIONER_CREATE_ROLES)
// built from roleGuard's shared payroll lists via a RELATIVE import: the
// static web-vs-backend analyzer (scripts/contract/hr-role-matrix.mjs) looks
// these names up in this file and only follows relative imports, so an
// "@/..." alias import made both gates resolve to [] (a false DRIFT after
// #1760). Values are unchanged: they mirror payroll-service READER_ROLES /
// PAYROLL_ROLES for GET / POST /v1/payroll/pensioners.
const PENSIONER_CREATE_ROLES = [...PAYROLL_ADMIN_ROLES];

export default async function NewPensionerPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => PENSIONER_CREATE_ROLES.includes(r))) {
    return <PermissionDenied module="pensioners" requiredRoles={PENSIONER_CREATE_ROLES} />;
  }
  const t = await getTranslations("pensionersNew");
  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/pensioners" backLabel="Back to Pensioners"
      />
      <CreatePensionerForm />
    </div>
  );
}
