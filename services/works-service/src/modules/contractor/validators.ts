import { z } from "zod";

export const createContractorSchema = z.object({
  name:           z.string().min(1).max(256),
  registrationNo: z.string().max(64).optional(),
  classId:        z.string().uuid().optional(),
  pan:            z.string().length(10).optional(),
  gst:            z.string().max(15).optional(),
  email:          z.string().email().max(256).optional(),
  phone:          z.string().max(20).optional(),
  address:        z.string().max(1024).optional(),
});

export const rateContractorSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
export const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type CreateContractorBody  = z.infer<typeof createContractorSchema>;
export type RateContractorBody    = z.infer<typeof rateContractorSchema>;

export const updateContractorSchema = z.object({
  name:           z.string().min(1).max(256).optional(),
  registrationNo: z.string().max(64).optional(),
  pan:            z.string().length(10).optional(),
  gst:            z.string().max(15).optional(),
  email:          z.string().email().max(256).optional(),
  phone:          z.string().max(20).optional(),
  address:        z.string().max(1024).optional(),
}).refine((b) => Object.keys(b).length > 0, "at least one field required");

export type UpdateContractorBody = z.infer<typeof updateContractorSchema>;
