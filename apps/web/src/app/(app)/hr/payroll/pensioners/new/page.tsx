import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { CreatePensionerForm } from "./CreatePensionerForm";

// payroll-critical fix: matches the backend's own PAYROLL_ROLES for
// POST /v1/payroll/pensioners (payroll/routes.ts) -- this page rendered the
// full creation form (PPO no., bank account/IFSC, PAN fields) for the
// unauthorized `employee` role. The POST itself is correctly server-gated
// (a submit attempt 403s), so this was not an active privilege-escalation
// bug, but showing an editable PII form an employee can never actually
// submit is confusing UX at best.
const PENSIONER_CREATE_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

export default async function NewPensionerPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => PENSIONER_CREATE_ROLES.includes(r))) {
    return <PermissionDenied module="pensioners" requiredRoles={PENSIONER_CREATE_ROLES} />;
  }
  try {
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
  } catch {
    return (
      <div className="page-main wrap">
        <RefreshErrorState error={toHumanError("load", { area: "new pensioner" })} backHref="/hr/payroll/pensioners" />
      </div>
    );
  }
}
