import { PageHeader } from "../../../_components/ds";
import { GuidedFileWizard } from "./GuidedFileWizard";

export default function EOfficeWorkspacePage({
  searchParams,
}: {
  searchParams?: { fileId?: string; step?: string };
}) {
  // GAP-ESTAB-WORKSPACE-01: resume an in-progress file from the URL so a refresh
  // or accidental navigation on step 3+ re-hydrates the file (the server GET
  // re-checks the caller's permission) instead of orphaning a draft.
  const fileId = typeof searchParams?.fileId === "string" ? searchParams.fileId : undefined;
  const stepRaw = typeof searchParams?.step === "string" ? Number(searchParams.step) : NaN;
  const step = Number.isFinite(stepRaw) ? stepRaw : undefined;

  return (
    <>
      <PageHeader
        title="Guided File Workspace"
        subtitle="One flow, end to end: diarise a receipt, open the file, note & route for approval, then draft the outgoing communication."
        back="/estab/list"
      />
      <GuidedFileWizard initialFileId={fileId} initialStep={step} />
    </>
  );
}
