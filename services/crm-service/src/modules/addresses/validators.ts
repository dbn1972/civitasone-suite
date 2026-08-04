/** CM-001 zod validators — multiple addresses per contact/account. */
import { z } from "zod";

export const ADDRESS_OWNER_TYPES = ["contact", "account"] as const;
export const ADDRESS_TYPES = ["billing", "shipping", "registered", "office", "home", "other"] as const;

export const createAddressBody = z.object({
  ownerType: z.enum(ADDRESS_OWNER_TYPES),
  ownerId: z.string().uuid(),
  addressType: z.enum(ADDRESS_TYPES),
  line1: z.string().min(1).max(500),
  line2: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(12).optional(),
  country: z.string().length(2).default("IN"),
  isPrimary: z.boolean().default(false),
});
export type CreateAddressBody = z.infer<typeof createAddressBody>;

// PUT replaces the mutable fields; owner is immutable (moving an address to another
// owner is a delete + create so the one-primary invariant can never straddle owners).
export const updateAddressBody = z.object({
  addressType: z.enum(ADDRESS_TYPES).optional(),
  line1: z.string().min(1).max(500).optional(),
  line2: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(12).nullable().optional(),
  country: z.string().length(2).optional(),
  isPrimary: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateAddressBody = z.infer<typeof updateAddressBody>;

export const listAddressesQuery = z.object({
  ownerType: z.enum(ADDRESS_OWNER_TYPES).optional(),
  ownerId: z.string().uuid().optional(),
});
export type ListAddressesQuery = z.infer<typeof listAddressesQuery>;

export const idParam = z.object({ id: z.string().uuid() });
