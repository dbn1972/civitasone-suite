import { PageHeader } from "../../../_components/ds";
import { getProcurementEMD, getProcurementPBG } from "../../../_data/loaders";
import { EmdBgTable } from "./EmdBgTable";

export default async function EmdBgPage() {
  // GAP-PROCUREMENT-EMD-BG-01: fetch the two registers independently and keep
  // their provenance SEPARATE. Previously both were merged into one list and a
  // single `source` was set to "error" if EITHER failed, so one register's
  // outage silently hid or stale-cached BOTH, and the headline stats were
  // computed server-side from the merged (possibly half-missing) list.
  const [{ data: emdEntries, source: emdSource }, { data: pbgEntries, source: pbgSource }] = await Promise.all([
    getProcurementEMD(),
    getProcurementPBG(),
  ]);

  return (
    <>
      <PageHeader
        title="EMD & Bank Guarantees"
        // GAP-PROCUREMENT-EMD-BG-05: honest subtitle — this is a read-only
        // register today (no release/extend/forfeit workflow exists yet).
        subtitle="Read-only register of earnest money deposits (EMD) and bank guarantees (BG) held as procurement security."
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
