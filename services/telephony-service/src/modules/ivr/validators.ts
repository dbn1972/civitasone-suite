/** zod validators for IVR hit routes. */
import { z } from "zod";

/** Single IVR hit entry in a batch upsert. */
export const ivrHitEntry = z.object({
  menuKey: z.string().min(1).max(64),
  digit: z.string().min(1).max(8).regex(/^[0-9*#]+$/, "DTMF digits only"),
  timestamp: z.string().datetime({ offset: true }).or(z.string().datetime()),
});

/** Batch upsert body — array of 1–50 IVR hits. */
export const batchIvrHitsBody = z.object({
  hits: z.array(ivrHitEntry).min(1).max(50),
});
export type BatchIvrHitsBody = z.infer<typeof batchIvrHitsBody>;

export const callIdParam = z.object({ id: z.string().uuid() });
