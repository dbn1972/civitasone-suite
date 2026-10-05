/**
 * Build a minimal PATCH body for PATCH /v1/crm/contacts/:id
 * (GAP-CRM-CONTACTS-DETAIL-EDIT-01).
 *
 * The old form sent every clearable field as `value || undefined`, which
 * JSON.stringify drops — so clearing Email/Phone/Organisation/Designation/City
 * silently left the stored value unchanged, making a DPDP data-correction /
 * erasure impossible from this screen. This builder instead:
 *   • emits only CHANGED fields (so an untouched form sends an empty patch and
 *     the caller can skip the request entirely), and
 *   • maps a trimmed-empty clearable field to explicit `null` ("clear"),
 *     mirroring the classification patch which already documents null = clear.
 *
 * `name` is required by the API schema and is never nullable: a trimmed-empty
 * name is simply never emitted (the form's `required` attribute blocks it).
 *
 * NOTE (HUMAN REVIEW): this assumes the contact PATCH route's zod schema
 * accepts `null` to clear email/phone/company/designation/city. That could not
 * be verified in this worktree (crm-service is absent). If the backend rejects
 * null, the field schemas must be made `.nullable()` — see report.
 */

/** The editable, clearable string fields of a contact (excludes the required name). */
export interface ContactFormFields {
  name: string;
  email: string;
  phone: string;
  company: string;
  designation: string;
  city: string;
}

/** Clearable fields: trimmed-empty → null, otherwise the trimmed string. */
const CLEARABLE: Array<keyof Omit<ContactFormFields, "name">> = [
  "email",
  "phone",
  "company",
  "designation",
  "city",
];

export interface ContactPatch {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  designation?: string | null;
  city?: string | null;
}

/** Normalise the initial loader value for comparison (null/undefined → ""). */
function norm(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Return only the fields that differ between `initial` and `form`.
 * - `name`: emitted (trimmed) only when it changed and is non-empty.
 * - clearable fields: emitted as the trimmed value, or `null` when cleared.
 * An unchanged form yields `{}`.
 */
export function buildContactPatch(
  initial: Partial<ContactFormFields>,
  form: ContactFormFields,
): ContactPatch {
  const patch: ContactPatch = {};

  const nextName = form.name.trim();
  if (nextName && nextName !== norm(initial.name)) {
    patch.name = nextName;
  }

  for (const field of CLEARABLE) {
    const before = norm(initial[field]);
    const after = form[field].trim();
    if (after === before) continue;
    patch[field] = after === "" ? null : after;
  }

  return patch;
}

/** True when the patch has no fields to send (so the caller can skip the request). */
export function isEmptyPatch(patch: ContactPatch): boolean {
  return Object.keys(patch).length === 0;
}
