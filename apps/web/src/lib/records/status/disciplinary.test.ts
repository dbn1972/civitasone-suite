import { describe, it, expect } from "vitest";
import { disciplinaryCanRaise, disciplinaryRaiseState } from "./disciplinary";
import { availableActions } from "@/app/(app)/hr/disciplinary/[id]/_components/caseActions";

describe("disciplinary raise rule (mirrors hrms state-machine submit_for_approval)", () => {
  it("finding_recorded may be raised in any proceeding; charge_memo_issued only in a minor one", () => {
    expect(disciplinaryCanRaise("finding_recorded", "major")).toBe(true);
    expect(disciplinaryCanRaise("finding_recorded", "minor")).toBe(true);
    expect(disciplinaryCanRaise("charge_memo_issued", "minor")).toBe(true);
    expect(disciplinaryCanRaise("charge_memo_issued", "major")).toBe(false);
  });

  it("dropped and closed cases are finished; pending_approval is awaiting", () => {
    expect(disciplinaryRaiseState("dropped", "major")).toBe("finished");
    expect(disciplinaryRaiseState("closed", "minor")).toBe("finished");
    expect(disciplinaryRaiseState("pending_approval", "major")).toBe("awaiting");
    expect(disciplinaryRaiseState("opened", "major")).toBe("not_yet");
  });

  it("agrees with the page action table: a finished case has no actions at all", () => {
    for (const s of ["dropped", "closed"]) expect(availableActions(s, "major")).toEqual([]);
  });
});
