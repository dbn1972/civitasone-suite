/**
 * Municipal cross-service outbox emissions — shop-service reference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FINANCE_CHALLAN_CREATE, NOTIFICATION_SEND } from "@civitasone/events";

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => {}),
}));

import { enqueue } from "../src/shared/outbox.js";
import {
  emitMunicipalFeeChallan,
  emitMunicipalNotification,
  municipalDecisionNotificationEventType,
} from "../src/shared/cross-events.js";

const tx = {} as never;
const ctx = { tenantId: "t1", actorId: "u1", correlationId: "c1" };

describe("shop cross-events", () => {
  beforeEach(() => {
    vi.mocked(enqueue).mockClear();
  });

  it("emitMunicipalFeeChallan enqueues finance.challan.create when fee > 0", async () => {
    await emitMunicipalFeeChallan(tx, ctx, {
      sourceRef: "app-1",
      depositor: "Test Shop",
      amountMinor: 50000n,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = vi.mocked(enqueue).mock.calls[0]![1] as { topic: string; payload: Record<string, unknown> };
    expect(call.topic).toBe(FINANCE_CHALLAN_CREATE);
    expect(call.payload.sourceService).toBe("shop");
    expect(call.payload.amountMinor).toBe(50000);
    expect(call.payload.depositor).toBe("Test Shop");
  });

  it("emitMunicipalFeeChallan skips zero fee", async () => {
    await emitMunicipalFeeChallan(tx, ctx, {
      sourceRef: "app-2",
      depositor: "Free",
      amountMinor: 0n,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("emitMunicipalNotification enqueues notification.send", async () => {
    await emitMunicipalNotification(tx, ctx, {
      eventType: "shop.application.submitted",
      recipient: "u1",
      recipientId: "u1",
      variables: { applicationId: "app-1" },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = vi.mocked(enqueue).mock.calls[0]![1] as { topic: string; payload: { eventType: string } };
    expect(call.topic).toBe(NOTIFICATION_SEND);
    expect(call.payload.eventType).toBe("shop.application.submitted");
  });

  it("municipalDecisionNotificationEventType maps approved decisions", () => {
    expect(municipalDecisionNotificationEventType("shop.application.decided", "approved")).toBe(
      "citizen.application.approved",
    );
  });
});
