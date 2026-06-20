import { z } from "zod";

export const createAlertRuleBody = z.object({
  name:         z.string().min(1).max(128),
  triggerEvent: z.string().min(1),
  conditions:   z.record(z.unknown()).default({}),
  channel:      z.string().min(1),
  recipients:   z.array(z.string()).default([]),
});
export type CreateAlertRuleBody = z.infer<typeof createAlertRuleBody>;

export const alertRuleIdParam = z.object({ id: z.string().uuid() });
