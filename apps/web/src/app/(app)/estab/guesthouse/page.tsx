import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGuesthouseBookings } from "../../../_data/loaders";
import type { GuesthouseBookingSummary } from "@civitasone/types";

const bookingStatusColors: Record<GuesthouseBookingSummary["status"], string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-blue-50 text-blue-700",
  checked_in: "bg-emerald-50 text-emerald-700",
  checked_out: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-700",
};

export default async function GuesthousePage() {
  const { data: bookings, source } = await getGuesthouseBookings();
  const today = new Date().toISOString().split("T")[0];
  const total = bookings.length;
  const occupied = bookings.filter((b) => b.status === "checked_in").length;
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.checkInDate > today).length;
  const cancelled = bookings.filter((b) => b.status === "cancelled").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Guest House</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Guest House Management</h1>
            <p className="mt-1 text-sm text-slate-600">Room booking, approvals and occupancy management.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Total Bookings", value: total, color: "text-slate-900" },
            { label: "Currently Occupied", value: occupied, color: "text-emerald-600" },
            { label: "Upcoming", value: upcoming, color: "text-blue-600" },
            { label: "Cancelled", value: cancelled, color: "text-red-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{s.label}</p>
              <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Guesthouse bookings" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Booking No</th>
                <th scope="col" className="px-4 py-3">Guest Name</th>
                <th scope="col" className="px-4 py-3">Designation</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Check-in</th>
                <th scope="col" className="px-4 py-3">Check-out</th>
                <th scope="col" className="px-4 py-3">Room Type</th>
                <th scope="col" className="px-4 py-3">Room No</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No bookings found</td>
                </tr>
              ) : (
                bookings.map((b) => (
                  <tr key={b.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">{b.bookingNo}</td>
                    <td className="px-4 py-3 text-slate-800">{b.guestName}</td>
                    <td className="px-4 py-3 text-slate-600">{b.designation ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{b.department ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{b.checkInDate}</td>
                    <td className="px-4 py-3 text-slate-600">{b.checkOutDate}</td>
                    <td className="px-4 py-3 text-slate-600">{b.roomType ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{b.roomNo ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${bookingStatusColors[b.status]}`}>
                        {b.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
