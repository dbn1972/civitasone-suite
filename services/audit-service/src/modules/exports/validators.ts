import { z } from "zod";

export const createExportBody = z.object({
  from:   z.string().datetime(),
  to:     z.string().datetime(),
  format: z.enum(["json", "csv"]).default("json"),
});
