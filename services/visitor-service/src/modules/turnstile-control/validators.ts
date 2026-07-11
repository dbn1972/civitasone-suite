/**
 * visitor-service: turnstile-control — Zod validation schemas.
 *
 * All request bodies are validated at the route boundary before
 * any command is published (zod at boundary, per architecture rules).
 *
 * Requirements validated: 7.1, 7.4, 7.6, 9.1, 9.2
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Passage Events
// ---------------------------------------------------------------------------

/** Body for POST /v1/visitor/turnstiles/passage — report a passage event. */
export const passageEventBody = z.object({
  passId: z.string().uuid(),
  gateId: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  passageCount: z.number().int().positive(),
  eventTimestamp: z.string().datetime(),
  offlineRecorded: z.boolean().optional().default(false),
});

/** Body for POST /v1/visitor/turnstiles/tailgating — report tailgating. */
export const tailgatingBody = z.object({
  passId: z.string().uuid(),
  gateId: z.string().uuid(),
  passageCount: z.number().int().positive().refine((n) => n > 1, {
    message: "passageCount must be greater than 1 for tailgating events",
  }),
});

// ---------------------------------------------------------------------------
// Emergency Control
// ---------------------------------------------------------------------------

/** Body for POST /v1/visitor/turnstiles/emergency-unlock. */
export const emergencyUnlockBody = z.object({
  locationId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

/** Body for POST /v1/visitor/turnstiles/emergency-restore. */
export const emergencyRestoreBody = z.object({
  locationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Command Acknowledgment
// ---------------------------------------------------------------------------

/** Body for POST /v1/visitor/turnstiles/commands/:commandId/ack. */
export const commandAckBody = z.object({
  commandId: z.string().uuid(),
});

/** Params for command routes with :commandId. */
export const commandIdParams = z.object({
  commandId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Anti-Passback Management
// ---------------------------------------------------------------------------

/** Body for POST /v1/visitor/turnstiles/anti-passback/reset. */
export const antiPassbackResetBody = z.object({
  passId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Offline Batch Sync
// ---------------------------------------------------------------------------

/** Body for POST /v1/visitor/devices/sync — batch sync of offline events. */
export const batchSyncBody = z.object({
  events: z
    .array(
      z.object({
        passId: z.string().uuid(),
        gateId: z.string().uuid(),
        direction: z.enum(["in", "out"]),
        passageCount: z.number().int().positive(),
        eventTimestamp: z.string().datetime(),
        offlineRecorded: z.boolean().optional().default(true),
      }),
    )
    .min(1)
    .max(100),
});
