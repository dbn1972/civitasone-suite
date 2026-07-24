import { PageHeader } from "../../../_components/ds";
import { IntakePanel } from "./IntakePanel";

/** SVC-082 — Online application & assisted-service intake (draft/ack/tracking). */
export default function IntakePage() {
  return (
    <>
      <PageHeader
        title="Application Intake"
        subtitle="Save a draft, submit for an acknowledgement with a tracking number, and track status."
      />
      <IntakePanel />
    </>
  );
}
