import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const feeMinorCoerce = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().min(0).transform((n: number) => String(n)),
]).default('0');

const amountMinorCoerce = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().min(0).transform((n: number) => String(n)),
]);

export const createTradeLicenseBody = z.object({
  licenseNo:      z.string().min(1).max(64).optional().transform((v) => v ?? randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()),
  businessName:   z.string().min(1).max(256),
  // Accept both proprietorName and ownerName
  proprietorName: z.string().min(1).max(256).optional(),
  ownerName:      z.string().min(1).max(256).optional(),
  address:        z.string().min(1),
  wardNo:         z.string().max(16).optional(),
  ward:           z.string().max(16).optional(), // alias
  businessType:   z.enum(['retail', 'manufacturing', 'service', 'hawker']),
  category:       z.enum(['A', 'B', 'C']).default('A'),
  issuedDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  licenseYear:    z.number().int().optional(),   // accept but derive expiryDate if missing
  feeMinor:       feeMinorCoerce,
  // extra fields from clients — accept and ignore
  mobileNo:       z.string().optional(),
  currency:       z.string().optional(),
}).transform((data) => ({
  ...data,
  proprietorName: data.proprietorName ?? data.ownerName ?? 'Unknown',
  wardNo:         data.wardNo ?? data.ward,
  expiryDate:     data.expiryDate ?? (data.licenseYear ? `${data.licenseYear}-03-31` : undefined),
}));

export const renewTradeLicenseBody = z.object({
  expiryDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  renewalYear: z.number().int().optional(),
  feeMinor:    feeMinorCoerce,
  version:     z.number().int().min(1).optional().default(1),
}).transform((data) => ({
  ...data,
  expiryDate: data.expiryDate ?? (data.renewalYear ? `${data.renewalYear}-03-31` : undefined),
}));

export const cancelTradeLicenseBody = z.object({
  reason:  z.string().min(1).max(500),
  version: z.number().int().min(1).optional().default(1),
});

export const recordPaymentBody = z.object({
  amountMinor: amountMinorCoerce,
  channel:     z.enum(['online', 'counter', 'cheque', 'dd']).optional(),
  mode:        z.enum(['online', 'counter', 'cheque', 'dd']).optional(), // alias
  reference:   z.string().max(128).optional(),
  paymentRef:  z.string().max(128).optional(), // alias
  paymentDate: z.string().optional(),
  version:     z.number().int().min(1).optional().default(1),
}).transform((data) => ({
  ...data,
  channel:   data.channel ?? data.mode ?? 'online',
  reference: data.reference ?? data.paymentRef,
}));

export const uuidParam = z.object({ id: z.string().uuid() });
export const paginationQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
