import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import AparNewForm from "./AparNewForm";

// GAP-HR-SF09A-010 / GAP-HR-APAR-NEW-01: this page used to render the form
// (a "use client" component) for every /hr-admitted role with no gate of
// its own -- manager/employee could open it, fill five fields, and only
// then learn (via a 403 on submit) that POST /v1/hrms/apar is HR-only
// (apar/routes.ts HR_ROLES = hr_admin/hr_officer/super_admin). Converted to
// a server component so the same check that already runs on the button in
// ../page.tsx (APAR_INITIATE_ROLES) also runs here, before the form ever
// renders -- matching the established pattern at hr/training/new/page.tsx.
// Kept in sync with ../page.tsx's own copy of this same list; see this
// app's role-matrix contract test for the two backend routes both mirror.
const APAR_INITIATE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default function AparNewPage() {
  const roles = getSessionRoles();
  const canInitiate = roles.some((r) => APAR_INITIATE_ROLES.includes(r));

  if (!canInitiate) {
    return <PermissionDenied module="APAR initiation" requiredRoles={APAR_INITIATE_ROLES} />;
  }

  return <AparNewForm />;
}
