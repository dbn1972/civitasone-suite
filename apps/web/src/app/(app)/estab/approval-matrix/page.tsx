import { PageHeader } from "../../../_components/ds";
import { ApprovalMatrixPanel } from "./ApprovalMatrixPanel";

export default function ApprovalMatrixPage() {
  return (
    <>
      <PageHeader
        title="Approval Matrix"
        subtitle="Define who must approve which module action by amount band. Modules raising an eFile are routed automatically."
        back="/estab/list"
      />
      <ApprovalMatrixPanel />
    </>
  );
}
