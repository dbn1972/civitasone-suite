import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Telephony"
      description="Government call-centre (CTI) — call lifecycle, agent queues, dispositions and SLA."
      links={[
        { href: "/telephony/calls", label: "Call Log", note: "Inbound/outbound calls, dispositions, SLA" },
        { href: "/telephony/agents", label: "Agent Queue", note: "Live agent presence and routing" },
        { href: "/telephony/dispositions", label: "Dispositions", note: "Completed-call wrap-up breakdown" },
        { href: "/telephony/list", label: "Call Log (legacy)", note: "Original API-backed list view" },
      ]}
    />
  );
}
