/**
 * crm-service answers a synchronous 422 when a contact or activity is linked to an account that was
 * merged away / deactivated (ACCOUNT_INACTIVE) or does not exist in the tenant (ACCOUNT_NOT_FOUND).
 * Forms map just those two KNOWN codes to their own translated copy (namespace crmAccountLinkError);
 * the code itself is never displayed. Any other failure keeps the generic status-aware message.
 */
export type AccountLinkErrorKey = "inactive" | "notFound";

export function accountLinkErrorKey(status: number, code: string | null | undefined): AccountLinkErrorKey | null {
  if (status !== 422) return null;
  if (code === "ACCOUNT_INACTIVE") return "inactive";
  if (code === "ACCOUNT_NOT_FOUND") return "notFound";
  return null;
}

/**
 * The translated-copy key for a failed response, or null when it is not an account-link 422. Reads a
 * clone so the caller can still consume the body; tolerates a response that is not clonable / JSON.
 */
export async function accountLinkErrorKeyFromResponse(res: Response): Promise<AccountLinkErrorKey | null> {
  if (res.status !== 422) return null;
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return accountLinkErrorKey(res.status, typeof body?.code === "string" ? body.code : null);
  } catch {
    return null;
  }
}
