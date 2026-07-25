import { z } from "zod";
import { PROVIDERS, ENTITY_TYPES } from "./reconcile-domain.js";

export const exchangeBody = z.object({
  provider:   z.enum(PROVIDERS).default("gem"),
  entityType: z.enum(ENTITY_TYPES),
  entityId:   z.string().min(1).max(256),
  payload:    z.record(z.unknown()).optional(),
});
export type ExchangeBody = z.infer<typeof exchangeBody>;

export const refIdParam = z.object({ id: z.string().uuid() });
