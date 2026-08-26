/**
 * visitor-service: material-pass zod validators (routes.ts boundary).
 *
 * Matches the shape of `MaterialPassCreateInput` in `./commands.ts` exactly,
 * following the convention from `modules/blacklist/validators.ts`.
 */
import { z } from "zod";

export const idParam = z.object({ passId: z.string().uuid("invalid passId") });

export const materialPassCreateBody = z.object({
  passId: z.string().uuid("invalid passId"),
  locationId: z.string().uuid("invalid locationId"),
  items: z
    .array(
      z.object({
        description: z.string().min(1, "item description is required").max(500, "item description must be 500 characters or fewer"),
        quantity: z.number().int().min(1, "quantity must be at least 1"),
        serialNumber: z.string().max(64, "serialNumber must be 64 characters or fewer").nullable().optional(),
      }),
    )
    .min(1, "at least one item is required")
    .max(100, "maximum 100 items per pass"),
});
export type MaterialPassCreateBody = z.infer<typeof materialPassCreateBody>;

/**
 * Matches `MaterialPassReconcileInput` in `./commands.ts` exactly. `passId`
 * comes from the route's `:passId` param (see `idParam`), not the body — the
 * body carries the exit-time declaration only.
 */
export const materialPassReconcileBody = z.object({
  locationId: z.string().uuid("invalid locationId"),
  itemsPresentAtExit: z
    .array(
      z.object({
        description: z.string().min(1, "item description is required").max(500, "item description must be 500 characters or fewer"),
        quantity: z.number().int().min(1, "quantity must be at least 1"),
        serialNumber: z.string().max(64, "serialNumber must be 64 characters or fewer").nullable().optional(),
      }),
    )
    .max(100, "maximum 100 items per pass"),
});
export type MaterialPassReconcileBody = z.infer<typeof materialPassReconcileBody>;
