/**
 * Hold-registry blocking configuration (SmartTransfer OS, ST-M01-10).
 *
 * Spec §4, §11. Decision D-ST-16 (who owns holds / which hold types block) is
 * PROPOSED, so this row consumes ONLY the EXISTING `lifecycle.hrms_employee_holds`
 * table and its EXISTING hold types — it adds no new hold type, no publisher and
 * no court/vigilance integration. "Which hold types block a posting" is therefore
 * CONFIGURATION with a deliberately conservative default:
 *
 *   DEFAULT: every ACTIVE hold blocks, regardless of its hold_type.
 *
 * A hold is "active" when its status is `approved` or `active` (the two states
 * the table's partial index `hrms_hold_active_idx` already treats as live) AND
 * its effective window [effective_from, effective_to] covers the posting date.
 *
 * This default is intentionally the safest reading of a PROPOSED decision: a
 * court stay, vigilance clearance, pending enquiry or any other recorded,
 * approved hold stops a transfer until the registry owner (D-ST-16) narrows it.
 * A deployment MAY narrow the blocking set with the env allow-list below once
 * the owner decides which hold types should NOT block; it can never widen it
 * past the hold types the table already defines.
 *
 * The env value is parsed strictly — no `z.coerce.*` (house rule 8). It is a
 * comma-separated list of hold_type literals; an empty/unset value means the
 * conservative default (all active holds block). Any token that is not an
 * existing hold type is ignored (we never invent a hold type).
 */

/** The hold types the EXISTING table defines (migration 0103 CHECK constraint). */
export const KNOWN_HOLD_TYPES = [
  "salary",
  "increment",
  "promotion",
  "transfer",
  "all",
] as const;
export type HoldType = (typeof KNOWN_HOLD_TYPES)[number];

/** Hold statuses that count as "active" (mirrors hrms_hold_active_idx). */
export const ACTIVE_HOLD_STATUSES = ["approved", "active"] as const;

/** The env var that may narrow which hold types block a posting. */
export const BLOCKING_HOLD_TYPES_ENV = "WORKFORCE_CORE_BLOCKING_HOLD_TYPES" as const;

/**
 * The set of hold types that BLOCK a posting.
 *
 * Default (env unset/empty): all known hold types block — the conservative
 * "every active hold blocks" reading of PROPOSED D-ST-16. If the env lists one
 * or more valid hold types, only those block; unknown tokens are discarded so a
 * typo can never silently widen the set to a non-existent type (and an all-
 * invalid list falls back to the conservative default rather than blocking
 * nothing).
 */
export function blockingHoldTypes(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<HoldType> {
  const raw = env[BLOCKING_HOLD_TYPES_ENV];
  if (typeof raw !== "string" || raw.trim() === "") {
    return new Set(KNOWN_HOLD_TYPES);
  }
  const known = new Set<string>(KNOWN_HOLD_TYPES);
  const selected = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => known.has(t)) as HoldType[];
  // All tokens invalid → fall back to the conservative default (fail-safe).
  if (selected.length === 0) return new Set(KNOWN_HOLD_TYPES);
  return new Set(selected);
}
