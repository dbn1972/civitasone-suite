import { PageHeader } from "../../../_components/ds";
import { getProcurementEMD, getProcurementPBG, getProcurementVendors } from "../../../_data/loaders";
import { EmdBgTable } from "./EmdBgTable";

export default async function EmdBgPage() {
  // GAP-PROCUREMENT-EMD-BG-01: fetch the two registers independently and keep
  // their provenance SEPARATE. Previously both were merged into one list and a
  // single `source` was set to "error" if EITHER failed, so one register's
  // outage silently hid or stale-cached BOTH, and the headline stats were
  // computed server-side from the merged (possibly half-missing) list.
  const [{ data: rawEmd, source: emdSource }, { data: rawPbg, source: pbgSource }, vendors] = await Promise.all([
    getProcurementEMD(),
    getProcurementPBG(),
    getProcurementVendors({ limit: 200 }),
  ]);
  // The security register carries only vendorId; resolve display names here.
  // An unresolved id keeps the "Vendor <id8>" placeholder rather than a blank.
  const names = new Map((vendors.data ?? []).map((v) => [v.id, v.name]));
  const withName = (rows: typeof rawEmd) => rows.map((e) => ({ ...e, vendor: names.get(e.vendorId) ?? e.vendor }));
  const emdEntries = withName(rawEmd);
  const pbgEntries = withName(rawPbg);

  return (
    <>
      <PageHeader
        title="EMD & Bank Guarantees"
        subtitle="Register of earnest money deposits (EMD) and bank guarantees (BG) held as procurement security. Procurement officers can forfeit, refund or release live instruments."
      />

      {/* GAP-PROCUREMENT-EMD-BG-01/02/03/04/05: the stat cards, per-register
          error banners and the table all live in the client component, derived
          from the SAME useSeededResource reads, so figures and rows can never
          disagree and a partial failure is reported honestly per register. */}
      <EmdBgTable
        emdEntries={emdEntries}
        pbgEntries={pbgEntries}
        emdSource={emdSource}
        pbgSource={pbgSource}
      />
    </>
  );
}
