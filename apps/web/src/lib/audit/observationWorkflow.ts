// GAP-AUDIT-OBSERVATIONS-DETAIL-01: derive the observation workflow from the
// real status instead of hard-coded literals. Pure + unit-tested.

export type StepState = "done" | "current" | "todo";

export interface WorkflowStep {
  key: "raised" | "reply" | "committee" | "closure";
  label: string;
  state: StepState;
}

type ObsStatus = "open" | "replied" | "compliance_pending" | "partially_closed" | "closed" | string;

/**
 * Map an observation status (+ whether a reply exists) to the state of each
 * lifecycle step. Ordering: Raised → Reply/ATN → Committee review → Closure.
 *
 * - open: Raised done; Reply current (or done if a reply already exists); rest todo.
 * - replied: Raised+Reply done; Committee current; Closure todo.
 * - compliance_pending / partially_closed: Raised+Reply+Committee done; Closure current.
 * - closed: all done.
 * - unknown status: Raised done; the rest todo (honest, not fabricated).
 */
export function deriveWorkflow(status: ObsStatus, hasReply: boolean): WorkflowStep[] {
  const raised: StepState = "done";
  let reply: StepState;
  let committee: StepState;
  let closure: StepState;

  switch (status) {
    case "open":
      reply = hasReply ? "done" : "current";
      committee = "todo";
      closure = "todo";
      break;
    case "replied":
      reply = "done";
      committee = "current";
      closure = "todo";
      break;
    case "compliance_pending":
    case "partially_closed":
      reply = "done";
      committee = "done";
      closure = "current";
      break;
    case "closed":
      reply = "done";
      committee = "done";
      closure = "done";
      break;
    default:
      // Unknown status — only the raised step is certain.
      reply = hasReply ? "done" : "todo";
      committee = "todo";
      closure = "todo";
  }

  return [
    { key: "raised", label: "Raised", state: raised },
    { key: "reply", label: "Reply / ATN", state: reply },
    { key: "committee", label: "Committee review", state: committee },
    { key: "closure", label: "Closure", state: closure },
  ];
}

/** Map a StepState to the ds timeline <li> class. */
export function stepClass(state: StepState): "done" | "cur" | "todo" {
  return state === "done" ? "done" : state === "current" ? "cur" : "todo";
}
