import { PageHeader } from "../../../_components/ds";
import { DiscoveryPanel } from "./DiscoveryPanel";

/** SVC-090 — Proactive service & benefit discovery (consent-gated). */
export default function DiscoveryPage() {
  return (
    <>
      <PageHeader
        title="Proactive Benefit Discovery"
        subtitle="With citizen consent, match profiles against eligibility rules and surface likely-eligible services."
      />
      <DiscoveryPanel />
    </>
  );
}
