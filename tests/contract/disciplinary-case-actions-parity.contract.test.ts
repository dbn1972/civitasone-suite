/**
 * GAP-HR-DISCIPLINARY-DETAIL-06: the case page's action buttons
 * (apps/web .../disciplinary/[id]/_components/caseActions.ts) mirror
 * hrms-service's disciplinary state machine. This pins the two together:
 * every action the UI offers must be a transition the state machine allows,
 * and the only transitions the UI deliberately omits are the documented ones.
 */
import { describe, it, expect } from "vitest";
import { canTransition, MINOR_PENALTIES, MAJOR_PENALTIES, type CaseAction, type CaseStatus } from "../../services/hrms-service/src/modules/disciplinary/state-machine";
import {
  availableActions,
  MINOR_PENALTIES as UI_MINOR,
  MAJOR_PENALTIES as UI_MAJOR,
  type CaseActionKey,
} from "../../apps/web/src/app/(app)/hr/disciplinary/[id]/_components/caseActions";

const STATUSES: CaseStatus[] = [
  "opened", "charge_memo_issued", "inquiry_appointed", "finding_recorded", "pending_approval",
  "penalty_imposed", "appeal_filed", "appeal_decided", "closed", "dropped",
];

const UI_TO_MACHINE: Record<CaseActionKey, CaseAction> = {
  charge_memo: "issue_charge_memo",
  inquiry: "appoint_inquiry",
  finding: "record_finding",
  penalty: "impose_penalty",
  appeal: "file_appeal",
  appeal_decision: "decide_appeal",
  close: "close",
  drop: "drop",
};

describe("disciplinary case actions parity (UI vs state machine)", () => {
  for (const proceeding of ["minor", "major"] as const) {
    for (const status of STATUSES) {
      it(`${proceeding}/${status}: UI offers exactly the state machine's transitions (minus documented exclusions)`, () => {
        const ui = availableActions(status, proceeding).map((k) => UI_TO_MACHINE[k]).sort();
        const machine = (Object.values(UI_TO_MACHINE) as CaseAction[])
          .filter((a) => canTransition(status, a, proceeding).ok)
          // eOffice owns impose-from-pending_approval; manual impose would bypass the approval.
          .filter((a) => !(a === "impose_penalty" && status === "pending_approval"))
          .sort();
        expect(ui).toEqual(machine);
      });
    }
  }

  it("penalty vocabularies match the backend's", () => {
    expect([...UI_MINOR].sort()).toEqual([...MINOR_PENALTIES].sort());
    expect([...UI_MAJOR].sort()).toEqual([...MAJOR_PENALTIES].sort());
  });
});
