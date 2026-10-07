import { PageHeader } from "../../../../_components/ds";
import { SeekOpinionForm } from "./SeekOpinionForm";

export default function SeekOpinionPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="Seek Legal Opinion"
        subtitle="Raise a request for a legal opinion or precedent reference."
        back="/legal/opinions"
      />
      {/* GAP-LEGAL-OPINIONS-NEW-04: the implementation-detail banner ("legal
          notice … closest available command") was removed now that the form
          posts to the real opinions endpoint (GAP-LEGAL-OPINIONS-NEW-01). */}
      <SeekOpinionForm />
    </div>
  );
}
