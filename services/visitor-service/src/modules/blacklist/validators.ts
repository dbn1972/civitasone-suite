/**
 * visitor-service: blacklist/watchlist zod validators (routes.ts boundary).
 *
 * Matches the shape of `BlacklistAddInput` / `BlacklistApproveInput` /
 * `WatchlistAddInput` in `./commands.ts` exactly, following the same
 * convention as `modules/location/validators.ts`.
 */
import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid("invalid id") });

export const blacklistAddBody = z.object({
  personName: z.string().min(1, "personName is required").max(200, "personName must be 200 characters or fewer"),
  identityDocType: z.string().max(24, "identityDocType must be 24 characters or fewer").nullable().optional(),
  identityDocNumber: z.string().max(64, "identityDocNumber must be 64 characters or fewer").nullable().optional(),
  reason: z.string().min(1, "reason is required").max(2000, "reason must be 2000 characters or fewer"),
  locationId: z.string().uuid("invalid locationId").nullable().optional(),
  effectiveFrom: z.string().datetime({ message: "effectiveFrom must be an ISO timestamp" }).nullable().optional(),
  expiresAt: z.string().datetime({ message: "expiresAt must be an ISO timestamp" }).nullable().optional(),
});
export type BlacklistAddBody = z.infer<typeof blacklistAddBody>;

export const watchlistAddBody = z.object({
  personName: z.string().min(1, "personName is required").max(200, "personName must be 200 characters or fewer"),
  identityDocType: z.string().max(24, "identityDocType must be 24 characters or fewer").nullable().optional(),
  identityDocNumber: z.string().max(64, "identityDocNumber must be 64 characters or fewer").nullable().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  specialInstructions: z.string().max(2000, "specialInstructions must be 2000 characters or fewer").nullable().optional(),
  locationId: z.string().uuid("invalid locationId").nullable().optional(),
});
export type WatchlistAddBody = z.infer<typeof watchlistAddBody>;

export const listBlacklistQuery = z.object({
  status: z.enum(["pending", "active", "expired", "archived"]).optional(),
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type ListBlacklistQuery = z.infer<typeof listBlacklistQuery>;

export const listWatchlistQuery = z.object({
  locationId: z.string().uuid("invalid locationId").optional(),
});
export type ListWatchlistQuery = z.infer<typeof listWatchlistQuery>;
