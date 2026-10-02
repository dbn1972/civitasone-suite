/**
 * (Field errors are message KEYS, resolved by the form's i18n `err` namespace.)
 * GAP-FINANCE-VENDORS-01: pure form -> POST /v1/finance/vendors body builder.
 * Mirrors finance-service's createVendorBody (PAN / GSTIN / IFSC formats and
 * length limits) so the client rejects what the server would 400.
 */
import { z } from "zod";

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface VendorFormInput {
  name: string;
  category: string;
  pan: string;
  gstin: string;
  address: string;
  contactPerson: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
}

export interface CreateVendorRequest {
  name: string;
  category: string;
  pan: string;
  gstin?: string;
  address: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
}

const upper = (v: string) => v.trim().toUpperCase();

const schema = z.object({
  name: z.string().trim().min(2, "nameInvalid").max(200),
  category: z.string().trim().min(1, "categoryRequired").max(100),
  pan: z.string().transform(upper).refine((v) => PAN_RE.test(v), "panInvalid"),
  gstin: z.string().transform(upper).refine((v) => v === "" || GSTIN_RE.test(v), "gstinInvalid"),
  address: z.string().trim().min(2, "addressRequired").max(500),
  contactPerson: z.string().trim().max(200),
  phone: z.string().trim().refine((v) => v === "" || (v.length >= 6 && v.length <= 20), "phoneInvalid"),
  email: z.string().trim().refine((v) => v === "" || z.string().email().safeParse(v).success, "emailInvalid"),
  bankName: z.string().trim().min(2, "bankNameRequired").max(200),
  bankAccount: z.string().trim().min(5, "bankAccountInvalid").max(30, "bankAccountInvalid"),
  ifsc: z.string().transform(upper).refine((v) => IFSC_RE.test(v), "ifscInvalid"),
});

export function buildCreateVendorRequest(
  input: VendorFormInput,
): { ok: true; body: CreateVendorRequest } | { ok: false; errors: Partial<Record<keyof VendorFormInput, string>> } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<keyof VendorFormInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof VendorFormInput;
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const d = parsed.data;
  return {
    ok: true,
    body: {
      name: d.name,
      category: d.category,
      pan: d.pan,
      ...(d.gstin ? { gstin: d.gstin } : {}),
      address: d.address,
      ...(d.contactPerson ? { contactPerson: d.contactPerson } : {}),
      ...(d.phone ? { phone: d.phone } : {}),
      ...(d.email ? { email: d.email } : {}),
      bankName: d.bankName,
      bankAccount: d.bankAccount,
      ifsc: d.ifsc,
    },
  };
}
