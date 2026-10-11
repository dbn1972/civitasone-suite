/** zod validators — applied at the route boundary. */
import { z } from "zod";

/**
 * Create-cycle body. Only user-supplied fields; tenant/jurisdiction/actor come
 * from the server context, never the body (house rule 9). No z.coerce.boolean,
 * no money fields.
 *
 * `movementTypeId` and the three calendar instants are required: a transfer
 * cycle is always of a movement type (spec §5) and always has a window, and the
 * emitted `smarttransfer.cycle.created` event (frozen contract, #1976) requires
 * all three — so the write path can never produce a contract-invalid event.
 */
export const createCycleBody = z.object({
  name: z.string().min(1).max(200),
  movementTypeId: z.string().uuid(),
  calendar: z.object({
    opensAt: z.string().datetime(),
    freezesAt: z.string().datetime(),
    closesAt: z.string().datetime(),
  }),
});
export type CreateCycleBody = z.infer<typeof createCycleBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const commandIdParam = z.object({ commandId: z.string().uuid() });

export const listQuery = z.object({
  status: z.string().max(32).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;
