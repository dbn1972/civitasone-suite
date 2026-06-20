import { z } from "zod";

export const createVendorBody = z.object({
  name:        z.string().min(1).max(256),
  gstin:       z.string().max(15).optional(),
  pan:         z.string().max(10).optional(),
  email:       z.string().email().optional(),
  phone:       z.string().max(20).optional(),
  mse:         z.boolean().default(false),
  msme:        z.boolean().default(false),
  udyamNo:     z.string().max(32).optional(),
  bankAccount: z.string().max(32).optional(),
  ifsc:        z.string().max(11).optional(),
});
export type CreateVendorBody = z.infer<typeof createVendorBody>;

export const empanelBody = z.object({
  category:   z.string().min(1).max(128),
  validUntil: z.string().optional(),
});
export type EmpanelBody = z.infer<typeof empanelBody>;

export const blacklistBody = z.object({
  reason: z.string().min(5).max(500),
});
export type BlacklistBody = z.infer<typeof blacklistBody>;

export const idParam = z.object({ id: z.string().uuid() });
