// GAP-RECRUITMENT-NEW-06: pure helpers for the requisitions screen (status -> available actions, labels).

export type Requisition = {
  id: string;
  requisitionNo: string;
  title: string;
  vacancies: number;
  status: string;
  currentStage: number;
  approvalChain?: Array<{ stage: string; role: string }>;
  publishedOpeningId?: string | null;
  confidential?: boolean;
};

export type RequisitionAction = "submit" | "approve" | "return" | "publish";

/**
 * Which workflow actions the screen offers for a status. The server re-checks the state, the stage role and the
 * maker-checker rule on every call; this only avoids offering an action that can never apply.
 */
export function actionsFor(status: string): RequisitionAction[] {
  switch (status) {
    case "draft":
    case "returned":
      return ["submit"];
    case "pending_approval":
      return ["approve", "return"];
    case "approved":
      return ["publish"];
    default:
      return [];
  }
}

/** Name of the approval stage a pending requisition is waiting on, or null. */
export function currentStageLabel(r: Pick<Requisition, "status" | "currentStage" | "approvalChain">): string | null {
  if (r.status !== "pending_approval") return null;
  const stage = r.approvalChain?.[r.currentStage];
  return stage ? stage.stage : null;
}

/** Parses GET /requisitions; null when the payload is not the expected shape (an error, never "empty"). */
export function parseRequisitions(body: unknown): Requisition[] | null {
  const list = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) return null;
  return list.filter((r): r is Requisition => !!r && typeof r === "object" && typeof (r as Requisition).id === "string");
}
