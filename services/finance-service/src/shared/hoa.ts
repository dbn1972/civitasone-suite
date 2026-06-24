/**
 * Government Head of Account (HoA) 18-digit segmentation.
 *
 * Layout (CGA / PFMS / LMMHA mandate):
 *   Major Head     4 digits   (positions  1– 4)
 *   Sub-Major Head 2 digits   (positions  5– 6)
 *   Minor Head     3 digits   (positions  7– 9)
 *   Sub-Head       2 digits   (positions 10–11)
 *   Detailed Head  2 digits   (positions 12–13)
 *   Object Head    2 digits   (positions 14–15)
 *   -- remaining 3 digits are reserved / padding to reach 18 --
 *
 * The canonical CGA "15-digit" classification (4+2+3+2+2+2) is carried in an
 * 18-character field in PFMS; the trailing 3 digits are zero-padded reserved
 * positions. We parse all six classification segments plus the reserved tail.
 *
 * Pure module: no DB, no HTTP, no queue. Unit-testable in isolation.
 */

export class HoaError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "HoaError";
  }
}

export interface HoaSegments {
  majorHead: string;     // 4
  subMajorHead: string;  // 2
  minorHead: string;     // 3
  subHead: string;       // 2
  detailedHead: string;  // 2
  objectHead: string;    // 2
  reserved: string;      // 3 (trailing positions)
}

const SEGMENTS: ReadonlyArray<{ key: keyof HoaSegments; width: number; label: string }> = [
  { key: "majorHead", width: 4, label: "Major Head" },
  { key: "subMajorHead", width: 2, label: "Sub-Major Head" },
  { key: "minorHead", width: 3, label: "Minor Head" },
  { key: "subHead", width: 2, label: "Sub-Head" },
  { key: "detailedHead", width: 2, label: "Detailed Head" },
  { key: "objectHead", width: 2, label: "Object Head" },
  { key: "reserved", width: 3, label: "Reserved" },
];

export const HOA_TOTAL_WIDTH = 18;

/**
 * Parse an 18-digit HoA code into its structured segments.
 * Throws HoaError if the code is not exactly 18 numeric digits, or if any
 * individual segment is not numeric / the correct width.
 */
export function parseHoA(code: string | null | undefined): HoaSegments {
  if (code == null) {
    throw new HoaError("HOA_EMPTY", "head of account code is required");
  }
  const raw = String(code).trim();
  if (raw.length !== HOA_TOTAL_WIDTH) {
    throw new HoaError(
      "HOA_BAD_LENGTH",
      `head of account must be exactly ${HOA_TOTAL_WIDTH} digits, got ${raw.length}`,
    );
  }
  if (!/^\d+$/.test(raw)) {
    throw new HoaError("HOA_NON_NUMERIC", "head of account must contain only digits 0-9");
  }

  const out = {} as HoaSegments;
  let offset = 0;
  for (const seg of SEGMENTS) {
    const part = raw.slice(offset, offset + seg.width);
    if (part.length !== seg.width || !/^\d+$/.test(part)) {
      throw new HoaError(
        "HOA_BAD_SEGMENT",
        `${seg.label} must be ${seg.width} numeric digits`,
      );
    }
    out[seg.key] = part;
    offset += seg.width;
  }
  return out;
}

/** True if `code` is a well-formed 18-digit HoA. */
export function validateHoA(code: string | null | undefined): boolean {
  try {
    parseHoA(code);
    return true;
  } catch {
    return false;
  }
}

/** Convenience: extract the 4-digit major head (throws if malformed). */
export function majorHeadOf(code: string | null | undefined): string {
  return parseHoA(code).majorHead;
}
