import Link from "next/link";

const links = [
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
];

export default function EstabHubPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Establishment</h1>
          <p className="mt-1 text-sm text-slate-600">Administration hub — files, meetings, fleet, guest house and compliance.</p>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <p className="text-sm font-semibold text-slate-900">{link.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{link.note}</p>
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
