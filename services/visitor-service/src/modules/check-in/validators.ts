/**
 * visitor-service: check-in / check-out / verify zod validators (routes.ts boundary).
 *
 * Matches the shapes consumed by `./commands.ts` (checkInRecord, checkOutRecord)
 * and the synchronous verify endpoint.
 */
import { z } from "zod";

export const verifyPassBody = z.object({
  /** Compact RS256 JWT from the visitor's QR code. */
  qrToken: z.string().min(1, "qrToken is required"),
  /** Gate performing the verification. */
  gateId: z.string().uuid("invalid gateId"),
  /** Optional identity document hash for blacklist/watchlist screening. */
  identityDocHash: z.string().max(128).nullable().optional(),
});
export type VerifyPassBody = z.infer<typeof verifyPassBody>;

export const checkInBody = z.object({
  passId: z.string().uuid("invalid passId"),
  gateId: z.string().uuid("invalid gateId"),
  gateTerminalId: z.string().max(64).nullable().optional(),
  offlineRecorded: z.boolean().optional(),
  verificationMethod: z.enum(["qr", "manual", "face"]).optional(),
  timestamp: z.string().datetime({ message: "timestamp must be an ISO timestamp" }).nullable().optional(),
});
export type CheckInBody = z.infer<typeof checkInBody>;

export const checkOutBody = z.object({
  passId: z.string().uuid("invalid passId"),
  gateId: z.string().uuid("invalid gateId"),
  gateTerminalId: z.string().max(64).nullable().optional(),
  offlineRecorded: z.boolean().optional(),
  verificationMethod: z.enum(["qr", "manual", "face"]).optional(),
  timestamp: z.string().datetime({ message: "timestamp must be an ISO timestamp" }).nullable().optional(),
});
export type CheckOutBody = z.infer<typeof checkOutBody>;

export const gateSyncParam = z.object({
  gateId: z.string().uuid("invalid gateId"),
});
export type GateSyncParam = z.infer<typeof gateSyncParam>;
