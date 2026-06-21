import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementVendors } from "../../../_data/loaders";

const empanelmentColors: Record<string, string> = {
  empanelled: "bg-emerald-50 text-emerald-700",
  provisional: "bg-amber-50 text-amber-700",
  blacklisted: "bg-red-50 text-red-700",
  not_empanelled: "bg-slate-100 text-slate-600",
};

const empanelmentLabels: Record<string, string> = {
  empanelled: "Empanelled",
  provisional: "Provisional",
  blacklisted: "Blacklisted",
  not_empanelled: "Not Empanelled",
};

export default async function Page() {
  const { data: vendors, source } = await getProcurementVendors();

  return (
    <PageShell title="Vendors" description="Approved vendor directory with empanelment status and ratings.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">Vendors</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="Vendors list">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Vendor Code</th>
              <th scope="col" className="px-4 py-3 text-left">Name</th>
              <th scope="col" className="px-4 py-3 text-left">GSTIN</th>
              <th scope="col" className="px-4 py-3 text-left">Category</th>
              <th scope="col" className="px-4 py-3 text-left">Empanelment</th>
              <th scope="col" className="px-4 py-3 text-right">Rating</th>
              <th scope="col" className="px-4 py-3 text-left">Contact</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-slate-600">{vendor.vendorCode}</td>
                <td className="px-4 py-3">
                  <Link href={`/procurement/vendors/${vendor.id}`} className="font-medium text-indigo-600 hover:underline">
                    {vendor.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-slate-500">{vendor.gstin ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{vendor.category}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${empanelmentColors[vendor.empanelmentStatus] ?? "bg-slate-100 text-slate-600"}`}>
                    {empanelmentLabels[vendor.empanelmentStatus] ?? vendor.empanelmentStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {vendor.rating !== undefined ? `${vendor.rating}/5` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{vendor.contactPerson ?? vendor.phone ?? "—"}</td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No vendors found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
