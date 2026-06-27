import { ModuleHub } from "../../_components/ModuleHub";

export default function EstabHubPage() {
  return (
    <ModuleHub
      title="Establishment"
      description="Run the office's day-to-day paperwork — files and notes, post, meetings, vehicles and the guest house."
      help="estab"
      links={[
        { href: "/estab/dashboard", label: "Dashboard", note: "Overview of all establishment activities" },
        { href: "/estab/list", label: "File Register", note: "Digital file tracking (eOffice)" },
        { href: "/estab/dak", label: "DAK Registry", note: "Inward dak receipt & file opening" },
        { href: "/estab/dispatch", label: "Dispatch", note: "Outward correspondence register" },
        { href: "/estab/approvals", label: "Approvals", note: "Yellow → green note approval queue" },
        { href: "/estab/files/new", label: "New File", note: "Open a new digital file" },
        { href: "/estab/meetings", label: "Meetings", note: "Schedule, agenda, MOM & action tracking" },
        { href: "/estab/vehicles", label: "Fleet", note: "Vehicle management & logbook" },
        { href: "/estab/guesthouse", label: "Guest House", note: "Room bookings & occupancy" },
        { href: "/estab/compliance", label: "Compliance", note: "Action & decision compliance tracking" },
      ]}
    />
  );
}
