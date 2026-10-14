import { describe, it, expect } from "vitest";
import { validateDakForm, EMPTY_DAK_FORM } from "./dakForm";

const TODAY = "2026-10-15";
const UUID = "3f9a1c2e-1111-4222-8333-444455556666";

describe("validateDakForm (GAP-ESTAB-DAK-03)", () => {
  it("Given only sender and subject, Then the payload carries just those two keys", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: " Home Ministry ", subject: " Memo " }, TODAY);
    expect(r).toEqual({ ok: true, payload: { fromAddress: "Home Ministry", subject: "Memo" } });
  });

  it("Given every optional field, Then the payload uses the service's keys and omits blanks", () => {
    const r = validateDakForm(
      { dakNo: "", fromAddress: "A", subject: "B", mode: "hand", receivedDate: "2026-10-14", urgency: "urgent", assignedTo: UUID, sourceSection: "Accounts" },
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      payload: { fromAddress: "A", subject: "B", mode: "hand", receivedDate: "2026-10-14", urgency: "urgent", assignedTo: UUID, sourceSection: "Accounts" },
    });
  });

  it("Given a blank sender and subject, Then both are reported with message keys", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "  ", subject: "" }, TODAY);
    expect(r).toEqual({ ok: false, errors: { fromAddress: "dakErrFromRequired", subject: "dakErrSubjectRequired" } });
  });

  it("Given a received date in the future, Then it is rejected", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "A", subject: "B", receivedDate: "2026-10-16" }, TODAY);
    expect(r).toEqual({ ok: false, errors: { receivedDate: "dakErrDateFuture" } });
  });

  it("Given today as the received date, Then it is accepted", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "A", subject: "B", receivedDate: TODAY }, TODAY);
    expect(r.ok).toBe(true);
  });
});
