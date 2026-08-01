import { z } from "zod";

/**
 * Aligned to `assessee.assessees` (schema.ts): assesseeType, identifierNo,
 * ownerName, and address are NOT NULL columns, so they are required here too.
 * The consumer (`consumer.ts` assesseeCreate) destructures exactly these key
 * names from the command payload — keep the two in lockstep.
 */
export const createAssesseeBody = z.object({
  assesseeType: z.enum(["property", "water_connection", "trade", "other"]),
  identifierNo: z.string().min(1).max(64),
  ownerName: z.string().min(1).max(200),
  address: z.string().min(1),
  wardNo: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
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
