import { PageHeader } from "../../../_components/ds";
import { getSessionRoles, getSessionUserId, ESTAB_DFA_APPROVER_ROLES, ESTAB_DFA_DRAFTER_ROLES } from "@/lib/auth/roleGuard";
import { DfaPanel } from "./DfaPanel";

export default function DfaPage() {
  // GAP-ESTAB-DFA-02: the server decides who may act; the panel only renders it.
  const roles = getSessionRoles();
  const canApprove = roles.some((r) => ESTAB_DFA_APPROVER_ROLES.includes(r));
  const canDraft = roles.some((r) => ESTAB_DFA_DRAFTER_ROLES.includes(r));
  return (
    <>
      <PageHeader
        title="Drafts For Approval (DFA)"
        subtitle="Draft outgoing letters, orders and memos, route them for approval, then sign and dispatch."
        back="/estab/list"
      />
      <DfaPanel viewerId={getSessionUserId()} canApprove={canApprove} canDraft={canDraft} />
    </>
  );
}
