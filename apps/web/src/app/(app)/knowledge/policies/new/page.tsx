import { PageHeader } from "../../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { CreatePolicyForm } from "./CreatePolicyForm";

const AUTHOR_ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export default function NewPolicyPage() {
  // GAP-KNOWLEDGE-POLICIES-01: web gate; the server also enforces ROLES on POST.
  requireAnyRole(AUTHOR_ROLES, "/knowledge/policies");

  return (
    <div className="wrap">
      <PageHeader
        title="New governed document"
        subtitle="Author a SOP, policy or circular. It starts as a draft and goes through maker-checker approval before publishing."
        back="/knowledge/policies"
      />
      <CreatePolicyForm />
    </div>
  );
}
