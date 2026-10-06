/**
 * GAP-CRM-CONTACTS-DETAIL-EDIT-07 follow-up (PII): GET /v1/crm/contacts/:id/detail
 * round-trips PAN and GSTIN for the edit form. They must be masked for non-admin
 * callers and only revealed to admins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/modules/contacts/repo.js", () => ({
  findDetail: vi.fn(),
  findById: vi.fn(),
}));

import * as repo from "../src/modules/contacts/repo.js";
import { getContactDetail } from "../src/modules/contacts/queries.js";

const DETAIL = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Asha Rao",
  email: "asha@techcorp.in",
  phone: "9998887777",
  pan: "ABCDE1234F",
  gstin: "27ABCDE1234F1Z5",
  deals: [],
  activityTimeline: [],
};

beforeEach(() => {
  vi.mocked(repo.findDetail).mockResolvedValue({ ...DETAIL } as never);
});

describe("getContactDetail PAN/GSTIN masking", () => {
  it("masks PAN and GSTIN for a non-admin caller", async () => {
    const d = await getContactDetail(DETAIL.id, "t1", false);
    expect(d).toMatchObject({ pan: "******234F", gstin: "***********F1Z5" });
    expect(JSON.stringify(d)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(d)).not.toContain("27ABCDE");
  });

  it("returns clear PAN and GSTIN for an admin caller", async () => {
    const d = await getContactDetail(DETAIL.id, "t1", true);
    expect(d).toMatchObject({ pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5" });
  });
});
