/**
 * Pure validation + request-shaping helpers for the public contact enquiry form
 * (GAP-CONTACT-HOME-01/02).
 *
 * Kept free of React and `next/*` so it can be unit-tested directly and imported by
 * both the "use client" form component and the `/api/contact` route handler without
 * dragging either into the other's bundle.
 *
 * The form posts to crm-service's PUBLIC lead-capture endpoint
 * (`POST /v1/crm/public/leads/:formKey`) through the local `/api/contact` proxy. The
 * field set below is a strict subset of that endpoint's `publicLeadBody`, so a valid
 * client payload is a valid server payload — the server re-validates everything, this
 * is only a first-pass to give the prospect inline errors.
 */

/** Topic routes a General/Sales/Security enquiry to the right queue via `source`. */
export const CONTACT_TOPICS = ["sales", "general", "security"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_TOPIC_LABELS: Record<ContactTopic, string> = {
  sales: "Sales & Government Procurement",
  general: "General inquiry",
  security: "Security report",
};

/** Mirrors the server's `source` field so leads are attributable per topic. */
export const CONTACT_TOPIC_SOURCE: Record<ContactTopic, string> = {
  sales: "contact_sales",
  general: "contact_general",
  security: "contact_security",
};

export interface ContactFormInput {
  name: string;
  department: string;
  email: string;
  phone: string;
  message: string;
  topic: ContactTopic;
  consent: boolean;
}

export type ContactFieldErrors = Partial<Record<keyof ContactFormInput, string>>;

// Mirror the crm publicLeadBody bounds so the first-pass check agrees with the server.
const NAME_MAX = 200;
const COMPANY_MAX = 200; // department -> company column
const EMAIL_MAX = 320;
const PHONE_MIN = 4;
const PHONE_MAX = 32;
const MESSAGE_MAX = 4000;

// Pragmatic email shape; the server uses zod .email() as the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Indian phone numbers: digits, spaces, +, -, (), min 4 digits once stripped.
const PHONE_DIGITS_RE = /\d/g;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= EMAIL_MAX && EMAIL_RE.test(v);
}

/** Field ids are stable so error focus + aria-describedby can target them. */
export const CONTACT_FIELD_IDS = {
  name: "contact-name",
  department: "contact-department",
  email: "contact-email",
  phone: "contact-phone",
  topic: "contact-topic",
  message: "contact-message",
  consent: "contact-consent",
} as const;

export function validateContact(input: ContactFormInput): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  const name = input.name.trim();
  if (name === "") errors.name = "Please enter your name.";
  else if (name.length > NAME_MAX) errors.name = `Name must be ${NAME_MAX} characters or fewer.`;

  if (input.department.trim().length > COMPANY_MAX) {
    errors.department = `Department must be ${COMPANY_MAX} characters or fewer.`;
  }

  const email = input.email.trim();
  if (email === "") errors.email = "Please enter your email address.";
  else if (!isValidEmail(email)) errors.email = "Please enter a valid email address.";

  const phone = input.phone.trim();
  if (phone !== "") {
    const digits = (phone.match(PHONE_DIGITS_RE) ?? []).length;
    if (phone.length > PHONE_MAX || digits < PHONE_MIN) {
      errors.phone = "Please enter a valid phone number, or leave it blank.";
    }
  }

  const message = input.message.trim();
  if (message === "") errors.message = "Please tell us how we can help.";
  else if (message.length > MESSAGE_MAX) {
    errors.message = `Message must be ${MESSAGE_MAX} characters or fewer.`;
  }

  if (!CONTACT_TOPICS.includes(input.topic)) errors.topic = "Please choose a topic.";

  if (!input.consent) {
    errors.consent = "Please confirm you agree to be contacted about your enquiry.";
  }

  return errors;
}

export function firstInvalidFieldId(errors: ContactFieldErrors): string | null {
  const order: Array<keyof ContactFormInput> = [
    "name",
    "department",
    "email",
    "phone",
    "topic",
    "message",
    "consent",
  ];
  for (const key of order) {
    if (errors[key]) return CONTACT_FIELD_IDS[key];
  }
  return null;
}

/**
 * Shape the validated input into crm-service's `publicLeadBody`.
 *
 * crm's public lead-capture endpoint is `.strict()` and models a prospect, not a
 * free-text ticket: it has `name`, `email`, `phone`, `company`, `consent` and `source`,
 * but NO message column. Sending an unmodelled `message` key would be a 400, so this
 * helper maps only the fields the endpoint accepts:
 *   - department -> `company`
 *   - topic      -> `source` (so Sales / General / Security leads are attributable)
 * The free-text message is handled by the `/api/contact` route separately (see there);
 * it is never pushed into a column it does not belong in.
 */
export function toPublicLeadBody(input: ContactFormInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    email: input.email.trim(),
    consent: input.consent === true,
    source: CONTACT_TOPIC_SOURCE[input.topic],
  };
  const phone = input.phone.trim();
  if (phone !== "") body.phone = phone;
  const department = input.department.trim();
  if (department !== "") body.company = department;
  return body;
}
