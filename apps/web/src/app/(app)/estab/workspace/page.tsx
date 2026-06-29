import { PageHeader } from "../../../_components/ds";
import { GuidedFileWizard } from "./GuidedFileWizard";

export default function EOfficeWorkspacePage() {
  return (
    <>
      <PageHeader
        title="Guided File Workspace"
        subtitle="One flow, end to end: diarise a receipt, open the file, note & route for approval, then draft the outgoing communication."
        back="/estab/list"
      />
      <GuidedFileWizard />
    </>
  );
}
