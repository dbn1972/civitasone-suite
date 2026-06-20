import { z } from "zod";

export const tenantIdParam = z.object({ id: z.string().uuid() });
export const scheduleBody = z.object({ cronExpr: z.string().min(5).max(128) });
