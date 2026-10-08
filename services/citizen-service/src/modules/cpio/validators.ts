import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const listCpioQuery = z.object({
  q:     safeText({ max: 120 }).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const createCpioBody = z.object({
  name:            safeText({ max: 200 }),
  designation:     safeText({ max: 200 }).optional(),
  publicAuthority: safeText({ max: 200 }),
  department:      safeText({ max: 200 }).optional(),
  email:           z.string().email().max(320).optional(),
  phone:           safeText({ max: 32 }).optional(),
});
export type CreateCpioBody = z.infer<typeof createCpioBody>;
