import { ModuleHub } from "../../_components/ModuleHub";
import { TelephonyLiveSummary } from "./_components/TelephonyLiveSummary";

export default function Page() {
  return (
    <ModuleHub
      title="Telephony"
      description="Government call-centre (CTI) — call lifecycle, agent queues, dispositions and SLA."
      links={[
        // GAP-TELEPHONY-HOME-04: explicit tile icons (also keyed in LinkTiles'
        // TILE_ICONS) so each tile is visually distinct rather than the generic
        // folder glyph.
        { href: "/telephony/calls", label: "Call Log", icon: "📞", note: "Inbound/outbound calls, dispositions, SLA" },
        { href: "/telephony/agents", label: "Agent Queue", icon: "🎧", note: "Live agent presence and routing" },
        { href: "/telephony/dispositions", label: "Dispositions", icon: "🗂", note: "Completed-call wrap-up breakdown" },
        // GAP-TELEPHONY-HOME-02 / LIST-05: the "Call Log (legacy)" tile pointing
        // at /telephony/list was removed — it duplicated Call Log and rendered
        // empty (the generic list mapper drops call rows, LIST-01). /telephony/list
        // now redirects to /telephony/calls so existing bookmarks still work.
      ]}
    >
      {/* GAP-TELEPHONY-HOME-03: live queued/abandoned/SLA summary so an agent
          sees the call-centre state without opening the Call Log. */}
      <TelephonyLiveSummary />
    </ModuleHub>
  );
}
