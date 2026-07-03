/** zod validators for custom-domains commands. */
import { z } from "zod";

/** Domain name regex (RFC 1035 + practical validation) */
const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export const registerDomainBody = z.object({
  domain: z.string().min(4).max(253).regex(domainRegex, "Invalid domain name"),
  verificationMethod: z.enum(["dns_txt", "dns_cname"]).default("dns_txt"),
});
export type RegisterDomainBody = z.infer<typeof registerDomainBody>;

export const domainIdParam = z.object({ id: z.string().uuid() });
