import { toHumanError } from "./messages";

/**
 * Plain-language message for a failed approve/reject style decision
 * (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-04). The response body is parsed only for
 * its machine `code`; it is never echoed, so a stale-version 409 reads
 * "someone else already decided this" instead of a raw JSON envelope.
 */
export type DecisionFailure = {
  /** Clerk-safe sentence to show the approver. */
  message: string;
  /** True when the record changed under the user, so the page should be refreshed. */
  stale: boolean;
};

async function readCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

export async function decisionFailure(res: Response, noun: string): Promise<DecisionFailure> {
  const code = await readCode(res);
  if (res.status === 409) {
    return {
      message: `Someone else already decided this ${noun}. Refresh to see the latest.`,
      stale: true,
    };
  }
  if (res.status === 403) {
    if (code === "MAKER_CHECKER") {
      return {
        message: `You recorded this ${noun}, so a different approver must decide it.`,
        stale: false,
      };
    }
    const human = toHumanError("forbidden");
    return { message: `${human.what} ${human.next}`, stale: false };
  }
  if (res.status === 404) {
    return { message: `This ${noun} could not be found. It may have been removed.`, stale: true };
  }
  const human = toHumanError("save", { area: noun });
  return { message: `${human.what} ${human.next}`, stale: false };
}
