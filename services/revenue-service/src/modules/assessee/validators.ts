import { z } from "zod";

export const createAssesseeBody = z.object({
  name: z.string().min(1).max(200),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  propertyNo: z.string().optional(),
  wardNo: z.string().optional(),
  address: z.string().optional(),
});

export const updateAssesseeBody = z.object({
  version: z.number().int().min(1),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().email().optional(),
    propertyNo: z.string().optional(),
    wardNo: z.string().optional(),
    address: z.string().optional(),
  }),
});
