import { describe, it, expect } from "vitest";
import { classifyStatus, isUnread, bucketCounts } from "./classifyStatus";

describe("classifyStatus (GAP-NOTIFICATIONS-LIST-02)", () => {
  it("buckets each status into exactly one group", () => {
    expect(classifyStatus("sent")).toBe("delivered");
    expect(classifyStatus("delivered")).toBe("delivered");
    expect(classifyStatus("read")).toBe("delivered");
    expect(classifyStatus("failed")).toBe("failed");
    expect(classifyStatus("bounced")).toBe("failed");
    expect(classifyStatus("queued")).toBe("inProgress");
    expect(classifyStatus("pending")).toBe("inProgress");
  });

  it("does not treat failed or queued as unread", () => {
    expect(isUnread("failed")).toBe(false);
    expect(isUnread("queued")).toBe(false);
    expect(isUnread("sent")).toBe(true);
    expect(isUnread("read")).toBe(false);
  });

  it("tile counts sum to the total", () => {
    const statuses = ["sent", "failed", "queued", "read", "delivered"];
    const c = bucketCounts(statuses);
    expect(c.total).toBe(5);
    expect(c.delivered + c.failed + c.inProgress).toBe(c.total);
    expect(c.delivered).toBe(3);
    expect(c.failed).toBe(1);
    expect(c.inProgress).toBe(1);
    expect(c.read).toBe(1);
    expect(c.unread).toBe(2); // sent + delivered (read excluded)
  });
});
