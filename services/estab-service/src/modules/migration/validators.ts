import { z } from "zod";

export const registerMigrationBody = z.object({
  legacyFileNo: z.string().min(1).max(120),
  subject:      z.string().min(3).max(500),
  dept:         z.string().min(1).max(120),
  pageCount:    z.number().int().nonnegative().default(0),
  scanRef:      z.string().min(1).optional(),
});
export type RegisterMigrationBody = z.infer<typeof registerMigrationBody>;

export const linkMigrationBody = z.object({
  efileId: z.string().uuid(),
});

export const listMigrationQuery = z.object({
  status: z.enum(["registered", "digitised", "linked"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});
