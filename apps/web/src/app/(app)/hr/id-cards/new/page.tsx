import { PageHeader, Card } from "../../../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { IssueIdCardForm } from "./IssueIdCardForm";

// Mirrors the parent /hr/id-cards list's own gate exactly (services/hrms-service/
// src/modules/id-cards/routes.ts's POST /v1/hrms/id-cards requireRole list) --
// GAP-HR-ID-CARDS-01.
const ID_CARDS_ROLES = ["hr_admin", "security_admin", "super_admin"];

export const metadata = { title: "Issue ID Card — CivitasOne HRMS" };

export default function IssueIdCardPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ID_CARDS_ROLES.includes(r));
  if (!canAccess) {
    return (
      <PermissionDenied
        module="ID cards"
        requiredRoles={ID_CARDS_ROLES}
        backHref="/hr/id-cards"
        backLabel="Back to ID cards"
      />
    );
  }

  return (
    <div className="page-main wrap">
      <PageHeader title="Issue ID Card" subtitle="Issue a new digital identity card." back="/hr/id-cards" backLabel="Back to ID cards" />
      <Card title="New card details">
        <div className="pad">
          <IssueIdCardForm />
        </div>
      </Card>
    </div>
  );
}
