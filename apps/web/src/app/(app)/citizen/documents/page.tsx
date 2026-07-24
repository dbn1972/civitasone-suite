import { PageHeader } from "../../../_components/ds";
import { DocumentPanel } from "./DocumentPanel";

/** SVC-084 — Document submission & verification. */
export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents & Verification"
        subtitle="Upload or fetch documents (DigiLocker), see the required-document checklist and verification status."
      />
      <DocumentPanel />
    </>
  );
}
