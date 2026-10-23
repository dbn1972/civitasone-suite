import { describe, it, expect, vi, afterEach } from "vitest";
import { mapHelpdeskTicketList, mapHelpdeskTicketDetail, mapAdminUserSummaries } from "./apiMappers";
import { mapTicketDetails } from "./loaders";

// CLOS2-S3-11: a record with no timestamp must not be stamped with "now" (it
// changes on every load and a SLA/ageing sort would rank it newest). The
// mapper passes null and the UI renders a dash.
describe("mappers never fabricate createdAt/updatedAt", () => {
  afterEach(() => vi.useRealTimers());

  const frozen = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-05-05T05:05:05.000Z"));
  };

  it("mapHelpdeskTicketDetail: no timestamps -> null, comment without createdAt -> null", () => {
    frozen();
    const t = mapHelpdeskTicketDetail({ id: "t1", subject: "Leak", comments: [{ id: "c1", content: "hi" }] })!;
    expect(t.createdAt).toBeNull();
    expect(t.updatedAt).toBeNull();
    expect(t.comments[0]!.createdAt).toBeNull();
  });

  it("mapHelpdeskTicketList: no timestamps -> null", () => {
    frozen();
    const [t] = mapHelpdeskTicketList({ data: [{ id: "t1", subject: "Leak" }] })!;
    expect(t!.createdAt).toBeNull();
    expect(t!.updatedAt).toBeNull();
  });

  it("loaders mapTicketDetails: no timestamps -> null", () => {
    frozen();
    const [t] = mapTicketDetails({ data: [{ id: "t1", subject: "Leak" }] })!;
    expect(t!.createdAt).toBeNull();
    expect(t!.updatedAt).toBeNull();
  });

  it("mapAdminUserSummaries: no createdAt -> null", () => {
    frozen();
    const [u] = mapAdminUserSummaries({ data: [{ id: "u1", email: "a@gov.in" }] })!;
    expect(u!.createdAt).toBeNull();
  });

  it("a real timestamp is passed through unchanged", () => {
    const t = mapHelpdeskTicketDetail({ id: "t1", subject: "Leak", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" })!;
    expect(t.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(t.updatedAt).toBe("2026-01-02T00:00:00Z");
  });
});
