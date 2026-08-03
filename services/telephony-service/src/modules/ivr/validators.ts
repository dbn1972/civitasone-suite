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
export type IvrHitEntry = z.infer<typeof ivrHitEntry>;

/**
 * Command envelope payload re-validated at the consume edge. The consumer
 * receives the caller's hits verbatim — ordinals are assigned by the consumer
 * inside the write transaction, never by the route.
 */
export const batchIvrHitsPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  callId: z.string().uuid(),
  hits: z.array(ivrHitEntry).min(1).max(50),
});

export const callIdParam = z.object({ id: z.string().uuid() });
