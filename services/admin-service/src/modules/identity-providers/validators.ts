import { z } from "zod";

export const KINDS = ["idp", "sso"] as const;
export type ProviderKind = (typeof KINDS)[number];

export const PROTOCOLS = ["OIDC", "SAML", "LDAP", "OAUTH2"] as const;
export const STATUSES = ["active", "inactive", "error"] as const;

/** The endpoint is only stored and shown, never fetched by the server. Plain http is refused. */
const endpoint = z.string().trim().min(1).max(2048).refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "ldaps:";
  } catch { return false; }
}, "endpoint must be an https:// or ldaps:// URL");

const name = z.string().trim().min(1).max(120);
const secret = z.string().min(1).max(4096);

export const createBody = z.object({
  name,
  protocol: z.enum(PROTOCOLS),
  endpoint,
  entityId: z.string().trim().max(512).default(""),
  clientId: z.string().trim().min(1).max(256).optional(),
  clientSecret: secret.optional(),
  status: z.enum(STATUSES).default("inactive"),
}).strict();

export const updateBody = z.object({
  name: name.optional(),
  protocol: z.enum(PROTOCOLS).optional(),
  endpoint: endpoint.optional(),
  entityId: z.string().trim().max(512).optional(),
  clientId: z.string().trim().min(1).max(256).nullable().optional(),
  clientSecret: secret.optional(),
  status: z.enum(STATUSES).optional(),
}).strict();

export const idParam = z.object({ id: z.string().uuid() });
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
