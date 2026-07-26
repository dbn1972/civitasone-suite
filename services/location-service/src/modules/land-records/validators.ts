import { z } from "zod";

export const LAND_TYPES = ["agricultural", "residential", "commercial", "industrial", "government", "forest"] as const;
export const MUTATION_TYPES = ["sale", "inheritance", "gift", "partition", "government_acquisition"] as const;

export const createLandRecordBody = z.object({
  surveyNo: z.string().min(1).max(64),
  khasraNo: z.string().min(1).max(64).optional(),
  village: z.string().min(1).max(128),
  district: z.string().min(1).max(128),
  areaHectares: z.number().positive(),
  ownerName: z.string().min(1).max(256),
  landType: z.enum(LAND_TYPES),
  coordinates: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(500).optional(),
  documentRef: z.string().min(1).max(256).optional(),
});
export type CreateLandRecordBody = z.infer<typeof createLandRecordBody>;

export const mutateLandRecordBody = z.object({
  newOwnerName: z.string().min(1).max(256),
  mutationType: z.enum(MUTATION_TYPES),
});
export type MutateLandRecordBody = z.infer<typeof mutateLandRecordBody>;

export const idParam = z.object({ id: z.string().uuid() });
