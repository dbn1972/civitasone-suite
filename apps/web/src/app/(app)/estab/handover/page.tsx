import { PageHeader } from "../../../_components/ds";
import { HandoverPanel } from "./HandoverPanel";

export default function HandoverPage() {
  return (
    <>
      <PageHeader
        title="Charge Handover"
        subtitle="Reassign an officer's entire file charge to another operator on transfer, leave or retirement."
        back="/estab/list"
      />
      <HandoverPanel />
    </>
  );
}
