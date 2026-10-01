import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { CreatePensionerForm } from "./CreatePensionerForm";

// Gated on the same roles payroll-service enforces for POST
// /v1/payroll/pensioners (PAYROLL_ROLES in payroll/routes.ts) -- shared via
// roleGuard's PAYROLL_ADMIN_ROLES (GAP-PAYROLL-PENSIONERS-05).
//
// GAP-PAYROLL-PENSIONERS-NEW-05: the old try/catch + RefreshErrorState here
// duplicated error.tsx (RouteError with retry) and was practically
// unreachable; failures now go to the route's error boundary only.
export default async function NewPensionerPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="pensioners" requiredRoles={PAYROLL_ADMIN_ROLES} />;
  }
  const t = await getTranslations("pensionersNew");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/pensioners" backLabel="Back to Pensioners"
      />
      <CreatePensionerForm />
    </div>
  );
}
