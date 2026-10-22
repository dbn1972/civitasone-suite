/**
 * The EXACT answer of POST /v1/crm/contacts/duplicate-check, for the stored contacts below. Web tests feed it to
 * the real parser and screens; crm-service's dedup-typed-contact-check.test.ts asserts the real route returns
 * precisely this body for the same contacts, so the two sides cannot drift apart unnoticed.
 *
 *  - `data` is the envelope; each match is { id, name, matchedFields, score } and NOTHING else (no email, phone,
 *    company); `score` is a whole number 0-100 (the sum of the matched rules' weights);
 *  - best match first.
 */
export const DUP_CONTACT_ASHA = "3f2a1b4c-0000-4000-8000-000000000002";
export const DUP_CONTACT_MEERA = "3f2a1b4c-0000-4000-8000-000000000001";

/** The request that produces it: a typed phone + email, no name. */
export const DUP_CHECK_REQUEST = { phone: "9876543210", email: "asha.rao@example.gov.in" } as const;

export const REAL_DUPLICATE_CHECK_RESPONSE = {
  data: [
    { id: DUP_CONTACT_ASHA, name: "Asha Rao", matchedFields: ["email", "phone"], score: 70 },
    { id: DUP_CONTACT_MEERA, name: "Meera Devi", matchedFields: ["phone"], score: 30 },
  ],
} as const;
