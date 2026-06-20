import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProcurementVendorById } from "../../../../_data/loaders";

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

export default async function Page({ params }: { params: { id: string } }) {
  const { data: vendor, source } = await getProcurementVendorById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <Link href="/procurement/vendors" className="hover:text-slate-900">Vendors</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{vendor?.name ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Vendor Profile</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {vendor ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{vendor.name}</h2>
                  <p className="mt-0.5 text-sm text-slate-500">{vendor.vendorCode} · {vendor.category}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${empanelmentColors[vendor.empanelmentStatus] ?? "bg-slate-100 text-slate-600"}`}>
                  {empanelmentLabels[vendor.empanelmentStatus] ?? vendor.empanelmentStatus}
                </span>
              </div>

              {vendor.rating !== undefined && (
                <div className="mt-3">
                  <p className="text-xs text-slate-500">Rating</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{vendor.rating}/5</p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 md:grid-cols-3">
                {vendor.gstin && (
                  <div>
                    <p className="text-xs text-slate-500">GSTIN</p>
                    <p className="mt-1 font-mono text-sm text-slate-800">{vendor.gstin}</p>
                  </div>
                )}
                {vendor.panNo && (
                  <div>
                    <p className="text-xs text-slate-500">PAN</p>
                    <p className="mt-1 font-mono text-sm text-slate-800">{vendor.panNo}</p>
                  </div>
                )}
                {vendor.contactPerson && (
                  <div>
                    <p className="text-xs text-slate-500">Contact Person</p>
                    <p className="mt-1 text-sm text-slate-800">{vendor.contactPerson}</p>
                  </div>
                )}
                {vendor.email && (
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="mt-1 text-sm text-slate-800">{vendor.email}</p>
                  </div>
                )}
                {vendor.phone && (
                  <div>
                    <p className="text-xs text-slate-500">Phone</p>
                    <p className="mt-1 text-sm text-slate-800">{vendor.phone}</p>
                  </div>
                )}
                {vendor.address && (
                  <div className="col-span-2 md:col-span-3">
                    <p className="text-xs text-slate-500">Address</p>
                    <p className="mt-1 text-sm text-slate-800">{vendor.address}</p>
                  </div>
                )}
              </div>
            </section>

            {(vendor.bankAccountNo || vendor.ifscCode) && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold text-slate-800">Bank Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  {vendor.bankAccountNo && (
                    <div>
                      <p className="text-xs text-slate-500">Account No</p>
                      <p className="mt-1 font-mono text-sm text-slate-800">{vendor.bankAccountNo}</p>
                    </div>
                  )}
                  {vendor.ifscCode && (
                    <div>
                      <p className="text-xs text-slate-500">IFSC Code</p>
                      <p className="mt-1 font-mono text-sm text-slate-800">{vendor.ifscCode}</p>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Vendor not found
          </div>
        )}
      </section>
    </main>
  );
}
