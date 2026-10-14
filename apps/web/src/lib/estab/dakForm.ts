import { z } from "zod";

/**
 * Client-side validation for the DAK register form, mirroring the service's
 * registerInwardBody (services/estab-service/src/modules/files/validators.ts).
 * Error values are message KEYS in the estabW2 namespace, never English text, so the
 * page can translate them (GAP-ESTAB-DAK-03).
 */
export const DAK_MODES = ["post", "email", "fax", "hand", "portal", "courier"] as const;
export const DAK_URGENCIES = ["urgent", "immediate"] as const;

export type DakFormState = {
  dakNo: string;
  fromAddress: string;
  subject: string;
  mode: string;
  receivedDate: string;
  urgency: string;
  /** hrms employee id of the addressee officer, or null. */
  assignedTo: string | null;
  sourceSection: string;
};

export const EMPTY_DAK_FORM: DakFormState = {
  dakNo: "", fromAddress: "", subject: "", mode: "", receivedDate: "", urgency: "", assignedTo: null, sourceSection: "",
};

export type DakFormErrors = Partial<Record<"fromAddress" | "subject" | "receivedDate" | "dakNo" | "sourceSection", string>>;

const blankToUndefined = (v: string) => (v.trim() === "" ? undefined : v.trim());

/** Payload keys are exactly those the service accepts; empty optional fields are omitted. */
export function validateDakForm(
  form: DakFormState,
  todayYmd: string,
): { ok: true; payload: Record<string, string> } | { ok: false; errors: DakFormErrors } {
  const schema = z.object({
    dakNo: z.string().max(64, "dakErrTooLong").optional(),
    fromAddress: z.string().min(1, "dakErrFromRequired"),
    subject: z.string().min(1, "dakErrSubjectRequired"),
    mode: z.enum(DAK_MODES).optional(),
    urgency: z.enum(DAK_URGENCIES).optional(),
    receivedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dakErrDateInvalid")
      .refine((d) => d <= todayYmd, "dakErrDateFuture")
      .optional(),
    assignedTo: z.string().uuid().optional(),
    sourceSection: z.string().max(64, "dakErrTooLong").optional(),
  });
  const parsed = schema.safeParse({
    dakNo: blankToUndefined(form.dakNo),
    fromAddress: form.fromAddress.trim(),
    subject: form.subject.trim(),
    mode: blankToUndefined(form.mode),
    urgency: blankToUndefined(form.urgency),
    receivedDate: blankToUndefined(form.receivedDate),
    assignedTo: form.assignedTo ?? undefined,
    sourceSection: blankToUndefined(form.sourceSection),
  });
  if (parsed.success) {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data)) if (typeof v === "string") payload[k] = v;
    return { ok: true, payload };
  }
  const errors: DakFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof DakFormErrors | undefined;
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
