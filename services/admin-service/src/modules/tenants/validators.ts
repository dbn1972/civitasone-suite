import { z } from "zod";

export const createTenantBody = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i),
  edition: z.enum(["govt_dept", "psu", "small_office"]),
  region: z.string().min(2).max(64),
  residency: z.string().min(2).max(64),
});
export type CreateTenantBody = z.infer<typeof createTenantBody>;

export const editionChangeBody = z.object({
  edition: z.enum(["govt_dept", "psu", "small_office"]),
});
export type EditionChangeBody = z.infer<typeof editionChangeBody>;

export const suspendBody = z.object({ reason: z.string().min(3).max(500) });
export type SuspendBody = z.infer<typeof suspendBody>;

export const idParam = z.object({ id: z.string().uuid() });
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
