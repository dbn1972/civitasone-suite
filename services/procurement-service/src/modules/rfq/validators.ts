import { z } from "zod";

const rfqItemSchema = z.object({
  itemName: z.string().min(1).max(256),
  quantity: z.number().int().positive().default(1),
  unit:     z.string().min(1).max(32).default("nos"),
});

export const createRfqBody = z.object({
  // Client-supplied rfqNo (if any) is advisory only — the consumer always
  // allocates the authoritative gapless number via allocateDocNo(), mirroring
  // indent create (#12).
  rfqNo:       z.string().max(64).optional(),
  title:       z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  indentRef:   z.string().max(128).optional(),
  closingDate: z.string().min(1),
  vendorIds:   z.array(z.string().uuid()).min(1).max(500),
  items:       z.array(rfqItemSchema).optional().default([]),
});
export type CreateRfqBody = z.infer<typeof createRfqBody>;

export const idParam = z.object({ id: z.string().uuid() });

const rfqRespondItemSchema = z.object({
  itemId:       z.string().uuid().optional(),
  itemName:     z.string().max(256).optional(),
  unitPrice:    z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative().default(0),
  notes:        z.string().max(500).optional(),
});

export const rfqRespondBody = z.object({
  items:         z.array(rfqRespondItemSchema).min(1),
  validUntil:    z.string().optional(),
  termsAccepted: z.boolean().default(false),
  remarks:       z.string().max(1000).optional(),
});
export type RfqRespondBody = z.infer<typeof rfqRespondBody>;
