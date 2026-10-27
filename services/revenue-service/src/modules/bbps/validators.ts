import { z } from "zod";

export const fetchBillBody = z.object({
  assesseeIdentifier: z.string().min(1).max(100),
});

/**
 * Owner decision #7: pay-bill takes ONLY the server-issued bill token (from
 * fetch-bill) plus the biller transaction id and channel. The assessee and the
 * amount are derived from the token server-side; any typed values are ignored.
 */
export const payBillBody = z.object({
  billToken: z.string().regex(/^[0-9a-f]{48}$/, "invalid bill token"),
  bbpsTxnId: z.string().min(1).max(50),
  channel: z.string().min(1).max(30),
});
