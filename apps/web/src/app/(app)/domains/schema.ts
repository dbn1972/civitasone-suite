import { z } from "zod";

/**
 * Validation for the "Register New Domain" form (GAP-DOMAINS-NEW-02 / -03).
 *
 * This is the single source of truth for domain-registration validation. The
 * form (domains/new/page.tsx) validates with `domainSchema.safeParse` before
 * POSTing. The matching server-side `domain-service` is absent from this
 * snapshot (no services/domain-service, no gateway /api/v1/domains route), so
 * the server cannot yet import this schema — see HUMAN REVIEW. When that
 * service is built it MUST re-use this schema so the client and server agree.
 *
 * Decisions recorded here (NEW-02 asked product to confirm allowed TLDs; the
 * conservative, fail-closed default is implemented):
 *  - Only `.gov.in` and `.nic.in` government hosts are accepted. A bare `.in`
 *    or `.co.in` host (e.g. example.co.in) is rejected — the old regex
 *    /^[a-z0-9.-]+\.(gov\.in|nic\.in|gov\.in|in)$/i accepted ANY `.in` host
 *    while its message promised only `.gov.in`/`.nic.in`.
 *  - `domainType` is cross-checked against the host suffix:
 *      gov.in       -> host must end in .gov.in (but NOT a state host)
 *      state.gov.in -> host must be a state government host (<state>.gov.in,
 *                      e.g. delhi.gov.in / tn.gov.in)
 *      nic.in       -> host must end in .nic.in
 *    The old form never compared the two.
 *  - The "Other" domain type is removed, not offered: no non-.in / non-gov
 *    host can pass, so offering it was misleading.
 */

/** Government hosts we accept. Label-based so we never match a bare `.in`. */
const GOV_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(gov|nic)\.in$/;

export const DOMAIN_TYPES = ["gov.in", "state.gov.in", "nic.in"] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

/** A `.gov.in` host with at least one label before `<state>.gov.in`, e.g. `delhi.gov.in`, `services.tn.gov.in`. */
function isStateGovHost(host: string): boolean {
  // state host = <label>.gov.in where the label directly before gov.in is the
  // state/UT (so at least two labels before `.in`: <state>.gov.in).
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+gov\.in$/.test(host) && host.endsWith(".gov.in");
}

/** Indian phone: optional +91 / 0 prefix, STD-landline (011-24301001) or 10-digit mobile. */
const PHONE = /^(?:\+91[\s-]?|0)?(?:\d{2,4}[\s-]?\d{6,8}|\d{10})$/;

export const domainSchema = z
  .object({
    domainName: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Enter a domain name.")
      .regex(GOV_HOST, "Enter a valid .gov.in or .nic.in domain."),
    domainType: z.enum(DOMAIN_TYPES, { errorMap: () => ({ message: "Choose a domain type." }) }),
    organisation: z.string().trim().min(1, "Enter the organisation."),
    department: z.string().trim().optional().default(""),
    state: z.string().trim().optional().default(""),
    contactEmail: z.string().trim().email("Enter a valid email address."),
    contactPhone: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine((v) => v === "" || PHONE.test(v), "Enter a valid Indian phone number, e.g. 011-24301001 or +91 9876543210."),
    notes: z.string().trim().optional().default(""),
  })
  .superRefine((val, ctx) => {
    const host = val.domainName;
    const isNic = host.endsWith(".nic.in");
    const isGov = host.endsWith(".gov.in");

    if (val.domainType === "nic.in" && !isNic) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domainType"], message: "This domain type requires a .nic.in domain." });
    }
    if (val.domainType === "gov.in") {
      if (!isGov) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domainType"], message: "This domain type requires a .gov.in domain." });
      }
    }
    if (val.domainType === "state.gov.in" && !(isGov && isStateGovHost(host))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domainType"], message: "A State Government domain must be a <state>.gov.in host." });
    }
  });

export type DomainInput = z.input<typeof domainSchema>;
export type DomainParsed = z.output<typeof domainSchema>;

/** Map a ZodError's issues to a flat `{ field: message }` record for the form. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
