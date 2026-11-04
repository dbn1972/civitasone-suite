import { toHumanError } from "./messages";
import { taskAlreadyDecidedMessage, type DecidedBy } from "./validationCopy";

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

async function readBody(res: Response): Promise<{ code?: string; decidedBy?: DecidedBy }> {
  try {
    const body = (await res.json()) as { code?: unknown; decidedBy?: unknown };
    return {
      code: typeof body?.code === "string" ? body.code : undefined,
      decidedBy: body?.decidedBy && typeof body.decidedBy === "object" ? (body.decidedBy as DecidedBy) : undefined,
    };
  } catch {
    return {};
  }
}

export async function decisionFailure(res: Response, noun: string): Promise<DecisionFailure> {
  const { code, decidedBy } = await readBody(res);
  if (res.status === 409) {
    // UAT T-EDGE TE-08: name the officer who decided first when the answer carries it.
    const named = code === "TASK_ALREADY_DECIDED" ? taskAlreadyDecidedMessage(decidedBy) : null;
    if (named) return { message: named, stale: true };
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
