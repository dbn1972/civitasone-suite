/**
 * GIGW 3.0 department identity and contact details for the public pages
 * (UAT gigw-content). One place for every NEXT_PUBLIC_GIGW_* value.
 *
 * All values are build-time, non-secret config set by the department before
 * go-live (see apps/web/.env.example). Defaults when a value is unset:
 *   - names (department, Web Information Manager designation) fall back to
 *     clearly labelled demonstration values (gigw.defaultDepartment,
 *     gigw.defaultWim in the message catalogues);
 *   - contact details (e-mail, telephone, address, hours, PIO) have NO
 *     fallback value: the page shows "To be configured before go-live"
 *     (gigw.toBeConfigured) and never an invented address or number.
 *
 * Next inlines process.env.NEXT_PUBLIC_* only where it is written literally,
 * so every key is read literally below, at call time (tests set env per case).
 */
export type GigwConfigField =
  | "department"
  | "wimDesignation"
  | "wimEmail"
  | "wimPhone"
  | "address"
  | "helpdeskEmail"
  | "helpdeskPhone"
  | "helpdeskHours"
  | "pioContact"
  | "reviewedAt";

/** The config key behind each field (documented in .env.example and the PR). */
export const GIGW_CONFIG_KEYS: Record<GigwConfigField, string> = {
  department: "NEXT_PUBLIC_GIGW_OWNER",
  wimDesignation: "NEXT_PUBLIC_GIGW_WIM_DESIGNATION",
  wimEmail: "NEXT_PUBLIC_GIGW_WIM_EMAIL",
  wimPhone: "NEXT_PUBLIC_GIGW_WIM_PHONE",
  address: "NEXT_PUBLIC_GIGW_ADDRESS",
  helpdeskEmail: "NEXT_PUBLIC_GIGW_HELPDESK_EMAIL",
  helpdeskPhone: "NEXT_PUBLIC_GIGW_HELPDESK_PHONE",
  helpdeskHours: "NEXT_PUBLIC_GIGW_HELPDESK_HOURS",
  pioContact: "NEXT_PUBLIC_GIGW_PIO_CONTACT",
  reviewedAt: "NEXT_PUBLIC_GIGW_REVIEWED_AT",
};

/** Fields with a demonstration default: the gigw.* message key that holds it. */
export const GIGW_NAME_DEFAULTS: Partial<Record<GigwConfigField, string>> = {
  department: "defaultDepartment",
  wimDesignation: "defaultWim",
};

export type GigwConfig = Record<GigwConfigField, string | null>;

function clean(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function readGigwConfig(): GigwConfig {
  return {
    department: clean(process.env.NEXT_PUBLIC_GIGW_OWNER),
    wimDesignation: clean(process.env.NEXT_PUBLIC_GIGW_WIM_DESIGNATION),
    wimEmail: clean(process.env.NEXT_PUBLIC_GIGW_WIM_EMAIL),
    wimPhone: clean(process.env.NEXT_PUBLIC_GIGW_WIM_PHONE),
    address: clean(process.env.NEXT_PUBLIC_GIGW_ADDRESS),
    helpdeskEmail: clean(process.env.NEXT_PUBLIC_GIGW_HELPDESK_EMAIL),
    helpdeskPhone: clean(process.env.NEXT_PUBLIC_GIGW_HELPDESK_PHONE),
    helpdeskHours: clean(process.env.NEXT_PUBLIC_GIGW_HELPDESK_HOURS),
    pioContact: clean(process.env.NEXT_PUBLIC_GIGW_PIO_CONTACT),
    reviewedAt: clean(process.env.NEXT_PUBLIC_GIGW_REVIEWED_AT),
  };
}

/**
 * GIGW practice: e-mail addresses are shown as name[at]domain[dot]in, not as
 * mailto links, so that they are not harvested automatically.
 */
export function displayEmail(address: string): string {
  return address.replace(/@/g, "[at]").replace(/\./g, "[dot]");
}

export function isEmailField(field: GigwConfigField): boolean {
  return field === "wimEmail" || field === "helpdeskEmail";
}
