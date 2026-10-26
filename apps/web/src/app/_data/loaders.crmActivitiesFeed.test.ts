/**
 * Contract: GET /v1/crm/activities (scoped feed, no subject) -> getCRMActivities() -> the
 * /crm/activities screen. The fixture is the exact wire shape crm-service emits (it validates its
 * own response against the same crmActivityFeedListSchema); this test feeds it through the shared
 * schema, the loader's mapper and the mapped-entry schema the table renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crmActivityFeedListSchema, CRMActivityEntryListSchema } from "@civitasone/schemas/web";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getCRMActivities, mapCRMActivityEntries, CRM_ACTIVITIES_FEED_LIMIT } from "./loaders";

const T = "aaaaaaaa-2222-4000-8000-0000000fd001";
const U = "cccccccc-4444-4000-8000-0000000fd00a";
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `55555555-cccc-4000-8000-0000000fd0${String(n).padStart(2, "0")}`,
  tenantId: T, actorName: "Asha Rao", text: "Called the citizen", contactId: null, dealId: null, accountId: null,
  type: "call", subject: "Follow-up call", status: "open", dueDate: "2030-01-05", remindAt: null, location: null,
  completedAt: null, createdAt: "2026-10-24T03:00:00.000Z", ownerId: U, owner: "Asha Rao",
  relatedType: null, relatedTo: null, ...over,
});
const FEED = {
  data: [
    row(1, { type: "task", status: "overdue", dueDate: "2020-01-01", relatedType: "contact", relatedTo: "Contact Of A", contactId: U }),
    row(2, { status: "completed", completedAt: "2026-10-23T10:00:00.000Z", relatedType: "other", relatedTo: "Account Of A", accountId: U }),
    row(3, { relatedType: "deal", relatedTo: "Deal Of A", dealId: U, owner: "—" }),
  ],
  pagination: { hasMore: false, pageSize: 200, total: 3, cursor: "3" },
};

describe("getCRMActivities (scoped feed contract)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("calls the paginated feed endpoint with no subject params", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getCRMActivities();
    const url = String(fetchJsonMock.mock.calls[0]![0]);
    expect(url).toBe(`/api/v1/crm/activities?limit=${CRM_ACTIVITIES_FEED_LIMIT}&offset=0`);
    expect(url).not.toMatch(/subjectType|subjectId/);
  });

  it("the real backend response passes the loader's wire schema", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getCRMActivities();
    const opts = fetchJsonMock.mock.calls[0]![2] as { responseSchema: typeof crmActivityFeedListSchema };
    expect(opts.responseSchema.safeParse(FEED).success).toBe(true);
    // a bare array (the old assumed shape) is no longer accepted: the contract is the envelope
    expect(opts.responseSchema.safeParse(FEED.data).success).toBe(false);
  });

  it("maps every row to what the table renders (owner, related record, derived overdue)", () => {
    const entries = mapCRMActivityEntries(FEED);
    expect(entries).toHaveLength(3);
    expect(CRMActivityEntryListSchema.safeParse(entries).success).toBe(true);
    expect(entries![0]).toMatchObject({ type: "task", status: "overdue", relatedTo: "Contact Of A", relatedType: "contact", owner: "Asha Rao", dueDate: "2020-01-01" });
    expect(entries![1]).toMatchObject({ status: "completed", relatedType: "other", relatedTo: "Account Of A" });
    expect(entries![2]).toMatchObject({ relatedType: "deal", owner: "—" });
  });

  it("an empty feed is a valid empty register, not an error", () => {
    expect(mapCRMActivityEntries({ data: [], pagination: { hasMore: false, pageSize: 200, total: 0 } })).toEqual([]);
  });
});
