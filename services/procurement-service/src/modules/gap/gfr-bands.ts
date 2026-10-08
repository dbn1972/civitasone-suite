/**
 * GAP2-PROCUREMENT-GFR-BANDS-07 — single documented source for the GFR 2017
 * procurement mode-band thresholds.
 *
 * Previously the band table (thresholds AND human prose) was a literal inline
 * in gap/routes.ts, so a threshold change meant editing route code and the
 * per-band `notes` strings were untranslatable English baked into the API.
 * This module is now the ONE place the thresholds live; the human copy is
 * carried as stable i18n keys (nameKey / notesKey) that the web resolves
 * against its en/hi message tree, so no prose crosses the API.
 *
 * Thresholds are minor-unit (paise) integers, as before. Values follow GFR 2017
 * (General Financial Rules): Rule 154 (local/direct purchase), Rule 152
 * (limited tender), Rule 149 (open tender), Rule 160 (global / single tender).
 * `thresholdMaxMinor === null` means "no upper bound" (the top open-ended band).
 */
export type GfrBand = {
  id: string;
  /** i18n key for the band's display name (resolved web-side). */
  nameKey: string;
  /** The GFR rule citation (stable identifier, not translated). */
  rule: string;
  /** Inclusive upper bound in paise; null = no upper bound. */
  thresholdMaxMinor: bigint | null;
  requiresTender: boolean;
  minBidders: number | null;
  /** i18n key for the band's explanatory note (resolved web-side). */
  notesKey: string;
};

/**
 * The canonical GFR mode bands, ascending by threshold. ST (single tender) is
 * a special non-threshold mode and is excluded from the automatic
 * value→mode selection below.
 */
export const GFR_BANDS: readonly GfrBand[] = [
  { id: "LS",  nameKey: "procurement.gfr.band.LS.name",  rule: "GFR Rule 154",  thresholdMaxMinor: 500000n,       requiresTender: false, minBidders: null, notesKey: "procurement.gfr.band.LS.note" },
  { id: "DP",  nameKey: "procurement.gfr.band.DP.name",  rule: "GFR Rule 154",  thresholdMaxMinor: 2500000n,      requiresTender: false, minBidders: 1,    notesKey: "procurement.gfr.band.DP.note" },
  { id: "LTR", nameKey: "procurement.gfr.band.LTR.name", rule: "GFR Rule 152a", thresholdMaxMinor: 100000000n,    requiresTender: true,  minBidders: 3,    notesKey: "procurement.gfr.band.LTR.note" },
  { id: "LTE", nameKey: "procurement.gfr.band.LTE.name", rule: "GFR Rule 152b", thresholdMaxMinor: 2500000000n,   requiresTender: true,  minBidders: 10,   notesKey: "procurement.gfr.band.LTE.note" },
  { id: "OT",  nameKey: "procurement.gfr.band.OT.name",  rule: "GFR Rule 149",  thresholdMaxMinor: 500000000000n, requiresTender: true,  minBidders: null, notesKey: "procurement.gfr.band.OT.note" },
  { id: "GT",  nameKey: "procurement.gfr.band.GT.name",  rule: "GFR Rule 160",  thresholdMaxMinor: null,          requiresTender: true,  minBidders: null, notesKey: "procurement.gfr.band.GT.note" },
  { id: "ST",  nameKey: "procurement.gfr.band.ST.name",  rule: "GFR Rule 160a", thresholdMaxMinor: null,          requiresTender: true,  minBidders: 1,    notesKey: "procurement.gfr.band.ST.note" },
];

/**
 * The GFR mode applicable to an estimated value (paise), or null when no band
 * applies. ST is skipped — it is a justification-based special mode, never
 * selected purely by value.
 */
export function applicableGfrMode(estimatedValueMinor: bigint): string | null {
  for (const b of GFR_BANDS) {
    if (b.id === "ST") continue;
    if (b.thresholdMaxMinor == null || estimatedValueMinor <= b.thresholdMaxMinor) {
      return b.id;
    }
  }
  return null;
}

/** API-serialisable band: bigint threshold rendered as a base-10 string. */
export function gfrBandsForApi(): Array<Omit<GfrBand, "thresholdMaxMinor"> & { thresholdMaxMinor: string | null }> {
  return GFR_BANDS.map((b) => ({
    ...b,
    thresholdMaxMinor: b.thresholdMaxMinor != null ? b.thresholdMaxMinor.toString() : null,
  }));
}
