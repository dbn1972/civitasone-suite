import { PageHeader } from "../../../_components/ds";
import { EstabApprovalsPanel } from "./EstabApprovalsPanel";

export default function EstabApprovalsPage() {
  return (
    <>
      <PageHeader
        title="eOffice Approvals"
        subtitle="Deputy Secretary and above — approve yellow notes to green (e-Signed)."
        back="/estab/list"
      />
      <EstabApprovalsPanel />
    </>
  );
}
