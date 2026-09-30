import { z } from "zod";

/**
 * Single source of truth for 7th CPC Pay Matrix level bounds and Central
 * Civil Services group classification.
 *
 * GAP-HR-DESIGNATIONS-01 / GAP-HR-EMPLOYEES-NEW-05: `DesignationsTable.tsx`
 * and the add-employee wizard's Step2 each hard-coded their OWN level→group
 * boundaries and disagreed with each other (level 1-3 and 10-11 landed in a
 * different group depending on which screen you looked at). Neither the
 * hrms-service schema nor `pay-matrix/routes.ts` (which only models
 * level→basic-pay cells, not group classification) has an authoritative
 * in-repo mapping to defer to, so this is sourced from the public DoPT
 * classification-of-posts notification instead (S.O. 3964(F), 9 Aug 2018,
 * F.No. 11012/10/2016-EsttA-II, Ministry of Personnel/DoPT, superseding the
 * 9 Nov 2017 order):
 *   Group A — Pay Matrix Level 10 to 18
 *   Group B — Pay Matrix Level 6 to 9
 *   Group C — Pay Matrix Level 1 to 5
 * "Group D" no longer exists — it was merged into Group C after the 6th CPC
 * and stays merged under the 7th CPC. Do not reintroduce it.
 *
 * If HR/legal later confirms a different or more precise mapping, update
 * SERVICE_GROUP_BANDS here — both screens read it, so they can't silently
 * drift apart again the way they did before this fix (see payLevels.test.ts
 * for the cross-screen parity test).
 */

export const MIN_PAY_LEVEL = 1;
export const MAX_PAY_LEVEL = 18;

/** Shared zod rule for a 7th-CPC pay-matrix level — reused by the create
 * form, the designations inline-edit path, and (mirrored, since it's a
 * separate service/package) hrms-service's createDesignationBody. */
export const payLevelSchema = z.number().int().min(MIN_PAY_LEVEL).max(MAX_PAY_LEVEL);

export type ServiceGroup = "Group-A" | "Group-B" | "Group-C";

export const SERVICE_GROUP_BANDS: ReadonlyArray<{
  group: ServiceGroup;
  minLevel: number;
  maxLevel: number;
}> = [
  { group: "Group-C", minLevel: 1, maxLevel: 5 },
  { group: "Group-B", minLevel: 6, maxLevel: 9 },
  { group: "Group-A", minLevel: 10, maxLevel: MAX_PAY_LEVEL },
];

/** True for any integer level the 7th CPC pay matrix actually defines (1-18). */
export function isValidPayLevel(level: unknown): level is number {
  return (
    typeof level === "number" &&
    Number.isInteger(level) &&
    level >= MIN_PAY_LEVEL &&
    level <= MAX_PAY_LEVEL
  );
}

/**
 * Central Civil Services group for a 7th-CPC pay-matrix level, or `null` when
 * `level` is missing or out of range — callers decide how to render that
 * ("—", "Not classified", etc.); this function never guesses.
 */
export function serviceGroup(level: number | null | undefined): ServiceGroup | null {
  if (!isValidPayLevel(level)) return null;
  const band = SERVICE_GROUP_BANDS.find((b) => level >= b.minLevel && level <= b.maxLevel);
  return band?.group ?? null;
}
