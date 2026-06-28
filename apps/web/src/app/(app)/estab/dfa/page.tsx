import { PageHeader } from "../../../_components/ds";
import { DfaPanel } from "./DfaPanel";

export default function DfaPage() {
  return (
    <>
      <PageHeader
        title="Drafts For Approval (DFA)"
        subtitle="Draft outgoing letters, orders and memos, route them for approval, then sign and dispatch."
        back="/estab/list"
      />
      <DfaPanel />
    </>
  );
}
