import { PageHeader } from "../../../_components/ds";
import { getSessionRoles, hasAnyRole, ESTAB_OPERATOR_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { OperatorsPanel } from "./OperatorsPanel";

export default function OperatorsPage() {
  // GAP-ESTAB-OPERATORS-02: only division/estab admins may enrol or
  // deactivate operators — mirrors estab-service operators ADMIN_ROLES
  // (estab_division_admin/estab_admin/super_admin), which already 403s others
  // on POST/PATCH. The server stays the authority; this hides controls that
  // would otherwise bounce a non-admin, and shows a read-only roster instead.
  const canAdminister = hasAnyRole(getSessionRoles(), ESTAB_OPERATOR_ADMIN_ROLES);
  return (
    <>
      <PageHeader
        title="eOffice File Operators"
        subtitle="Division admins enrol the employees who may hold and operate eOffice files. Only enrolled operators can be marked a file."
        back="/estab/list"
      />
      <OperatorsPanel canAdminister={canAdminister} />
    </>
  );
}
