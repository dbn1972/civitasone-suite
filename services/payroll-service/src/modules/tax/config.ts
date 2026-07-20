/**
 * P2: load FY-versioned tax configuration from `payroll.tax_slab_config` into
 * the engine's in-memory registry. Called once at boot (HTTP app + worker) and
 * may be re-called to refresh after a config change. A `to: null` slab bound is
 * mapped to Infinity (the open-ended top slab).
 */
import { db, scopedRead } from "../../shared/db.js";
import { taxSlabConfig } from "./schema.js";
import {
  registerTaxConfig, type Regime, type TaxSlab, type SurchargeBand,
} from "./engine.js";

interface RawSlab { from: number; to: number | null; rate: number }

export async function loadTaxConfig(): Promise<number> {
  const rows = await scopedRead((tx) => tx.select().from(taxSlabConfig));
  for (const r of rows) {
    const slabs: TaxSlab[] = (r.slabs as RawSlab[]).map((s) => ({
      from: s.from,
      to: s.to === null ? Infinity : s.to,
      rate: s.rate,
    }));
    const surchargeBands = (r.surchargeBands as SurchargeBand[]).map((b) => ({
      above: b.above, rate: b.rate,
    }));
    registerTaxConfig(r.regime as Regime, r.fyStartYear, {
      slabs,
      stdDeduction: Number(r.stdDeduction),
      rebateIncomeCap: Number(r.rebateIncomeCap),
      rebateMax: Number(r.rebateMax),
      surchargeBands,
    });
  }
  return rows.length;
}
