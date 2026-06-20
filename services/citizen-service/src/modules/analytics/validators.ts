import { z } from "zod";

export const tenantQuery = z.object({ tenantId: z.string().uuid().optional() });
