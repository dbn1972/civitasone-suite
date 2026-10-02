/**
 * GAP-FINANCE-EXPENDITURE-BILLS-01 / GAP-FINANCE-PAYMENTS-01: pure form ->
 * request-body builders for the New Bill and New Payment screens. The shapes
 * mirror finance-service's createBillBody / initiateEftBody (zod) so the
 * client rejects what the server would 400, and money is converted from a
 * rupees string to a paise STRING with no float math (lib/money).
 */
import { z } from "zod";
import { parseRupeesToPaise } from "@/lib/money";

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DDO_RE = /^[A-Za-z0-9]{6,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field errors carry a message KEY (resolved with the form's i18n `err` namespace), not English text. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface BillFormInput {
  billNo: string;
  vendorId: string;
  headId: string;
  ddoCode: string;
  amountRupees: string;
  billDate: string;
  poRef: string;
  grnRef: string;
}

export interface CreateBillRequest {
  billNo: string;
  vendorId: string;
  headId: string;
  ddoCode: string;
  grossMinor: string;
  currency: "INR";
  billDate?: string;
  poRef?: string;
  grnRef?: string;
}

const billSchema = z.object({
  billNo: z.string().trim().min(1, "billNoRequired").max(64, "billNoTooLong"),
  vendorId: z.string().regex(UUID_RE, "vendorRequired"),
  headId: z.string().regex(UUID_RE, "headRequired"),
  ddoCode: z.string().regex(DDO_RE, "ddoRequired"),
  billDate: z.string().regex(ISO_DATE, "dateInvalid").or(z.literal("")),
  poRef: z.string().trim().max(200),
  grnRef: z.string().trim().max(200),
});

export function buildCreateBillRequest(
  input: BillFormInput,
): { ok: true; body: CreateBillRequest } | { ok: false; errors: FieldErrors<keyof BillFormInput> } {
  const errors: FieldErrors<keyof BillFormInput> = {};
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof BillFormInput;
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  const grossMinor = parseRupeesToPaise(input.amountRupees);
  if (grossMinor === null) errors.amountRupees = "amountInvalid";
  if (!parsed.success || grossMinor === null) return { ok: false, errors };
  const d = parsed.data;
  return {
    ok: true,
    body: {
      billNo: d.billNo,
      vendorId: d.vendorId,
      headId: d.headId,
      ddoCode: d.ddoCode.toUpperCase(),
      grossMinor,
      currency: "INR",
      ...(d.billDate ? { billDate: d.billDate } : {}),
      ...(d.poRef ? { poRef: d.poRef } : {}),
      ...(d.grnRef ? { grnRef: d.grnRef } : {}),
    },
  };
}

export interface PaymentFormInput {
  billId: string;
  ddoCode: string;
  mode: string;
  /** The bill's net amount as a paise string -- the server requires full payment. */
  amountMinor: string;
}

export interface InitiatePaymentRequest {
  billId: string;
  ddoCode: string;
  mode: PaymentMode;
  amountMinor: string;
  currency: "INR";
}

export function buildInitiatePaymentRequest(
  input: PaymentFormInput,
): { ok: true; body: InitiatePaymentRequest } | { ok: false; errors: FieldErrors<keyof PaymentFormInput> } {
  const errors: FieldErrors<keyof PaymentFormInput> = {};
  if (!UUID_RE.test(input.billId)) errors.billId = "billRequired";
  if (!DDO_RE.test(input.ddoCode)) errors.ddoCode = "ddoRequired";
  if (!(PAYMENT_MODES as readonly string[]).includes(input.mode)) errors.mode = "modeRequired";
  if (!/^[1-9]\d*$/.test(input.amountMinor)) errors.amountMinor = "amountMissing";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      billId: input.billId,
      ddoCode: input.ddoCode.toUpperCase(),
      mode: input.mode as PaymentMode,
      amountMinor: input.amountMinor,
      currency: "INR",
    },
  };
}
