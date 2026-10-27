import { browserJson } from "@/lib/api/browserClient";
import { formatShortId } from "@/lib/formatters";

export type ConfigKind = "rate_head" | "rate_slab" | "penalty_rule" | "rebate_rule";
export type ConfigAction = "create" | "revise" | "end_date";

type Accepted = { data?: { id?: string; messageId?: string } };

/**
 * Owner decision #2 (2026-10-26): rate configuration is maker-checker. Every
 * change is a PROPOSAL (effective-dated, never in place) that a different
 * officer approves before anything live changes.
 */
export async function proposeConfig(input: {
  kind: ConfigKind;
  action: ConfigAction;
  effectiveFrom: string;
  targetId?: string;
  payload: Record<string, unknown>;
}): Promise<{ id: string | null }> {
  const res = await browserJson<Accepted>("v1/revenue/rate-config/proposals", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { id: res.data?.id ?? null };
}

/** Success copy shared by the propose forms. */
export function proposedMessage(noun: string, id: string | null): string {
  return `${noun} submitted for approval${id ? ` (proposal ${formatShortId(id)})` : ""}. Nothing changes until a different officer approves it — see "Awaiting approval" above.`;
}
