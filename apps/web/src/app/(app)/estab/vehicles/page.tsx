import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getVehicles } from "../../../_data/loaders";
import type { VehicleSummary } from "@civitasone/types";

const vehicleStatusColors: Record<VehicleSummary["status"], string> = {
  available: "bg-emerald-50 text-emerald-700",
  in_use: "bg-blue-50 text-blue-700",
  maintenance: "bg-amber-50 text-amber-700",
  reserved: "bg-purple-50 text-purple-700",
  disposed: "bg-slate-100 text-slate-500",
};

const fuelTypeColors: Record<VehicleSummary["fuelType"], string> = {
  petrol: "bg-slate-100 text-slate-600",
  diesel: "bg-slate-100 text-slate-600",
  cng: "bg-emerald-50 text-emerald-700",
  electric: "bg-blue-50 text-blue-700",
};

export default async function VehiclesPage() {
  const { data: vehicles, source } = await getVehicles();
  const total = vehicles.length;
  const available = vehicles.filter((v) => v.status === "available").length;
  const inUse = vehicles.filter((v) => v.status === "in_use").length;
  const maintenance = vehicles.filter((v) => v.status === "maintenance").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Fleet</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Vehicle Management</h1>
            <p className="mt-1 text-sm text-slate-600">Allocation, log books, fuel and maintenance for the fleet.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Total Fleet", value: total, color: "text-slate-900" },
            { label: "Available", value: available, color: "text-emerald-600" },
            { label: "In Use", value: inUse, color: "text-blue-600" },
            { label: "Under Maintenance", value: maintenance, color: "text-amber-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{s.label}</p>
              <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Vehicle No</th>
                <th className="px-4 py-3">Make / Model</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Fuel</th>
                <th className="px-4 py-3 text-right">Odometer (km)</th>
                <th className="px-4 py-3">Next Service</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No vehicles found</td>
                </tr>
              ) : (
                vehicles.map((v) => (
                  <tr key={v.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">{v.vehicleNo}</td>
                    <td className="px-4 py-3 text-slate-800">{v.make} {v.model}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{v.type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-slate-600">{v.assignedTo ?? "Pool"}</td>
                    <td className="px-4 py-3 text-slate-600">{v.driverName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${fuelTypeColors[v.fuelType]}`}>
                        {v.fuelType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{v.odometerKm.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{v.nextServiceDue ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${vehicleStatusColors[v.status]}`}>
                        {v.status.replace(/_/g, " ")}
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
