import { parseHoA, HoaError } from "../../shared/hoa.js";
import { majorHeadExists, type Reader } from "./repo.js";

/**
 * Full HoA validation:
 *  1. well-formed 18-digit segmentation (parseHoA), then
 *  2. the 4-digit major head exists in the major-head master.
 *
 * Throws HoaError on failure. `reader` lets callers run inside a tx.
 */
export async function assertValidHoAWithMaster(
  code: string | null | undefined,
  reader?: Reader,
): Promise<void> {
  const segments = parseHoA(code); // throws HoaError if malformed
  const exists = await majorHeadExists(segments.majorHead, reader);
  if (!exists) {
    throw new HoaError(
      "HOA_UNKNOWN_MAJOR_HEAD",
      `major head ${segments.majorHead} not found in major-head master`,
    );
  }
}
