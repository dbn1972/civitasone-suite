import { z } from "zod";

export const pincodeParam = z.object({
  code: z.string().regex(/^\d{6}$/, "PIN code must be exactly 6 digits"),
});
export type PincodeParam = z.infer<typeof pincodeParam>;

export const pincodeSearchQuery = z.object({
  q: z.string().min(1, "Search query is required").max(100, "Search query must be 100 characters or fewer"),
});
export type PincodeSearchQuery = z.infer<typeof pincodeSearchQuery>;

export const bulkImportBody = z.object({
  records: z.array(z.object({
    pincode: z.string().regex(/^\d{6}$/, "PIN code must be exactly 6 digits"),
    postOffice: z.string().min(1, "Post office name is required").max(200),
    district: z.string().min(1, "District is required").max(120),
    state: z.string().min(1, "State is required").max(120),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })).min(1, "At least one record required").max(10000, "Maximum 10000 records per batch"),
});
export type BulkImportBody = z.infer<typeof bulkImportBody>;

export const pincodeViewSchema = z.object({
  id: z.string().uuid(),
  pincode: z.string(),
  postOffice: z.string(),
  district: z.string(),
  state: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

export const pincodeListSchema = z.object({
  data: z.array(pincodeViewSchema),
});
