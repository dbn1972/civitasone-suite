import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";

export const uuidParam = z.object({ id: z.string().uuid() });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// BUG FIX: was z.string().regex(/^\d+$/), which rejects any plain JSON number
// outright ("Expected string, received number") -- every route in
// assessment/collection/bbps/rate-engine validators that uses this for a
// money-minor field (baseValue, amount, amountMinor, rateValue, bandFrom/
// bandTo) 400'd on the common case of a client sending a JSON number instead
// of a pre-stringified one. zMoneyMinorStringNonNeg is the canonical
// @civitasone/schemas money codec: accepts string | safe-integer number,
// rejects unsafe (>2^53) numbers instead of silently rounding them, and
// always normalises to a base-10 string -- same output type as before, so
// existing BigInt(...) call sites downstream are unaffected.
export const bigintString = zMoneyMinorStringNonNeg;
