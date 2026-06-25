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
      <div
        className="banner"
        style={{ background: "#fffaeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 12, padding: "11px 14px", margin: "0 0 16px", fontSize: 13, maxWidth: 820 }}
      >
        ℹ️ The legal service does not yet expose a dedicated opinions endpoint. This request is
        recorded as a legal notice (the closest available command) and routed to the addressee.
      </div>
      <SeekOpinionForm />
    </div>
  );
}
