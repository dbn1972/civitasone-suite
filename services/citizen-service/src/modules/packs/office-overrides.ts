/**
 * FN-22 — Cross-Office Fee & Form Variants (pure domain, no I/O).
 *
 * BRD: "offering office overrides: ward-specific fee slab, optional extra document,
 * without forking pack … Acceptance: Zone A fee differs from Zone B; same pack version."
 *
 * The point of this module is what it *refuses* to override. A zonal office may
 * tune what its citizens pay and what extra evidence it collects; it may not
 * quietly diverge the form, the workflow, the pattern or the head of account,
 * because then two offices would be running materially different services under
 * one pack version and one audit trail — which is the fork this FN exists to
 * prevent. Overriding the HOA is excluded for the same reason FN-14 makes it a
 * publish gate: money must land in the account the published pack declares.
 */

import type { PackManifestBlocks } from "./manifest-apply.js";
import type { RequiredDocument } from "../catalogue/domain.js";

/** Fields an offering office may vary. Everything else is pack-level and fixed. */
export interface OfficeOverride {
  officeId: string;
  /** Ward/zone-specific fee, in minor units (paise). */
  feeFromMinor?: number | undefined;
  /** Alternate flat schedule or slab table for this office. */
  feeScheduleId?: string | undefined;
  /** Locally required evidence *in addition to* the pack's documents. */
  additionalDocuments?: RequiredDocument[] | undefined;
  /** Local service promise; may be tighter or looser than the pack default. */
  slaDays?: number | undefined;
  /** Why this office differs — surfaced to auditors, not citizens. */
  note?: string | undefined;
}

export class OfficeOverrideError extends Error {}

/**
 * Validate a pack's override list at publish time.
 *
 * Throws rather than returning a result because this sits behind the same
 * publish gate as assertDefinitionPublishable — a malformed override must block
 * publish, not degrade silently at runtime for one zone.
 */
export function assertOfficeOverrides(
  overrides: unknown,
  opts: { offeringOfficeIds?: readonly string[] | null; packDocuments?: readonly RequiredDocument[] } = {},
): asserts overrides is OfficeOverride[] {
  if (overrides == null) return;
  if (!Array.isArray(overrides)) throw new OfficeOverrideError("OVERRIDES_NOT_A_LIST");

  const seen = new Set<string>();
  const packDocTypes = new Set((opts.packDocuments ?? []).map((d) => d.docType));
  // An empty/absent offering list means "all offices under the owner" (B1
  // default), so we cannot check membership — only reject duplicates.
  const allowed = opts.offeringOfficeIds && opts.offeringOfficeIds.length > 0
    ? new Set(opts.offeringOfficeIds)
    : null;

  for (const raw of overrides) {
    if (!raw || typeof raw !== "object") throw new OfficeOverrideError("OVERRIDE_NOT_AN_OBJECT");
    const o = raw as OfficeOverride;

    if (typeof o.officeId !== "string" || o.officeId.trim().length === 0) {
      throw new OfficeOverrideError("OVERRIDE_MISSING_OFFICE");
    }
    if (seen.has(o.officeId)) throw new OfficeOverrideError(`OVERRIDE_DUPLICATE_OFFICE: ${o.officeId}`);
    seen.add(o.officeId);

    if (allowed && !allowed.has(o.officeId)) {
      // Overriding for an office that is not offering the service would be dead
      // config that silently never applies.
      throw new OfficeOverrideError(`OVERRIDE_OFFICE_NOT_OFFERING: ${o.officeId}`);
    }

    if (o.feeFromMinor !== undefined) {
      if (!Number.isInteger(o.feeFromMinor) || o.feeFromMinor < 0) {
        throw new OfficeOverrideError(`OVERRIDE_BAD_FEE: ${o.officeId}`);
      }
    }
    if (o.slaDays !== undefined) {
      if (!Number.isInteger(o.slaDays) || o.slaDays <= 0) {
        throw new OfficeOverrideError(`OVERRIDE_BAD_SLA: ${o.officeId}`);
      }
    }

    for (const doc of o.additionalDocuments ?? []) {
      if (!doc || typeof doc.docType !== "string" || doc.docType.length === 0) {
        throw new OfficeOverrideError(`OVERRIDE_BAD_DOCUMENT: ${o.officeId}`);
      }
      if (packDocTypes.has(doc.docType)) {
        // Re-declaring a pack document would let an office quietly flip a
        // mandatory pack document to optional.
        throw new OfficeOverrideError(`OVERRIDE_DOCUMENT_SHADOWS_PACK: ${doc.docType}`);
      }
    }
    const localTypes = new Set<string>();
    for (const doc of o.additionalDocuments ?? []) {
      if (localTypes.has(doc.docType)) {
        throw new OfficeOverrideError(`OVERRIDE_DUPLICATE_DOCUMENT: ${doc.docType}`);
      }
      localTypes.add(doc.docType);
    }
  }
}

/**
 * Merge one office's overrides onto the pack blocks.
 *
 * Returns the blocks unchanged (same reference) when the office has no override,
 * so the common path costs nothing and callers can cheaply detect "this office
 * runs the pack as published".
 */
export function resolveBlocksForOffice(
  blocks: PackManifestBlocks,
  overrides: readonly OfficeOverride[] | null | undefined,
  officeId: string | null | undefined,
): PackManifestBlocks {
  if (!officeId || !overrides || overrides.length === 0) return blocks;
  const override = overrides.find((o) => o.officeId === officeId);
  if (!override) return blocks;

  const merged: PackManifestBlocks = { ...blocks };

  if (override.feeFromMinor !== undefined) merged.feeFromMinor = override.feeFromMinor;
  if (override.feeScheduleId !== undefined) merged.feeScheduleId = override.feeScheduleId;
  if (override.slaDays !== undefined) merged.slaDays = override.slaDays;

  if (override.additionalDocuments && override.additionalDocuments.length > 0) {
    // Append only — pack documents keep their position and mandatory flag.
    merged.requiredDocuments = [...(blocks.requiredDocuments ?? []), ...override.additionalDocuments];
  }

  return merged;
}

/** Offices whose citizens see something different from the published pack. */
export function officesWithOverrides(overrides: readonly OfficeOverride[] | null | undefined): string[] {
  return (overrides ?? []).map((o) => o.officeId);
}
