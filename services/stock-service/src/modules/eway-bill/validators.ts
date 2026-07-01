import { z } from "zod";

const PIN_REGEX = /^\d{6}$/;
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}[A-Z]{1}\d{1}$/;
const STATE_CODE_REGEX = /^\d{2}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createEwayBillBody = z.object({
  invoiceId:     z.string().uuid().optional(),
  dispatchId:    z.string().uuid().optional(),
  supplyType:    z.enum(["outward", "inward"]),
  subSupplyType: z.enum(["supply", "export", "job_work", "for_own_use", "sales_return", "others"]),
  docType:       z.enum(["invoice", "bill", "challan", "credit_note", "others"]),
  docNo:         z.string().min(1).max(50),
  docDate:       z.string().regex(DATE_REGEX, "must be YYYY-MM-DD"),
  fromGstin:     z.string().regex(GSTIN_REGEX, "invalid GSTIN format"),
  fromName:      z.string().min(1).max(100),
  fromAddr:      z.string().min(1).max(300),
  fromPin:       z.string().regex(PIN_REGEX, "must be 6-digit PIN"),
  fromStateCode: z.string().regex(STATE_CODE_REGEX, "must be 2-digit state code"),
  toGstin:       z.string().regex(GSTIN_REGEX).optional(),
  toName:        z.string().min(1).max(100),
  toAddr:        z.string().min(1).max(300),
  toPin:         z.string().regex(PIN_REGEX, "must be 6-digit PIN"),
  toStateCode:   z.string().regex(STATE_CODE_REGEX, "must be 2-digit state code"),
  totalValueMinor: z.number().int().positive(), // paise
  hsnCode:       z.string().min(4).max(8),
  transportMode: z.enum(["road", "rail", "air", "ship"]).optional(),
  vehicleNo:     z.string().max(20).optional(),
  transporterId: z.string().max(15).optional(),
});
export type CreateEwayBillBody = z.infer<typeof createEwayBillBody>;

export const cancelEwayBillBody = z.object({
  reason: z.string().min(5).max(250),
});
export type CancelEwayBillBody = z.infer<typeof cancelEwayBillBody>;

export const updateVehicleBody = z.object({
  vehicleNo:     z.string().min(4).max(20),
  transportMode: z.enum(["road", "rail", "air", "ship"]).optional(),
});
export type UpdateVehicleBody = z.infer<typeof updateVehicleBody>;

export const listQueryParams = z.object({
  status: z.enum(["pending", "active", "cancelled", "expired", "failed"]).optional(),
  limit:  z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
