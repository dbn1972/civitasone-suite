import { z } from "zod";

export const createAuctionBody = z.object({
  auctionNo:     z.string().min(1).max(64),
  indentRef:     z.string().min(1),
  title:         z.string().min(1).max(256),
  reserveMinor:  z.number().int().positive(),
  startAt:       z.string().datetime(),
  endAt:         z.string().datetime(),
  msePreference: z.boolean().default(true),
});
export type CreateAuctionBody = z.infer<typeof createAuctionBody>;

export const submitBidBody = z.object({
  vendorId: z.string().uuid(),
  bidMinor: z.number().int().positive(),
  isMse:    z.boolean().default(false),
});
export type SubmitBidBody = z.infer<typeof submitBidBody>;

export const idParam = z.object({ id: z.string().uuid() });
