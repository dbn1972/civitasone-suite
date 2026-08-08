import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractNotificationBindings,
  bindingsForEvent,
  formatAmountMajor,
  enqueuePackNotifications,
} from "./notification-bindings.js";

vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("./repo.js", () => ({
  findPublishedByServiceIdTx: vi.fn(),
}));

import { enqueue } from "../../shared/outbox.js";
import * as catalogueRepo from "./repo.js";

const TEMPLATE_SMS = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_WA = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function publishedDef(outputs: unknown[]) {
  return {
    id: "def-1",
    tenantId: TENANT,
    serviceKey: "trade-license",
    serviceId: SERVICE_ID,
    name: "Trade License",
    outputs,
  };
}

describe("FN-08 pack notification bindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts enabled bindings that have templateId", () => {
    const bindings = extractNotificationBindings([
      { type: "certificate", templateKey: "tl" },
      {
        kind: "notifications",
        bindings: [
          { event: "payment_due", channel: "whatsapp", enabled: true, templateId: TEMPLATE_WA },
          { event: "payment_due", channel: "sms", enabled: true, templateId: TEMPLATE_SMS },
          { event: "submitted", channel: "email", enabled: false, templateId: TEMPLATE_SMS },
          { event: "approved", channel: "sms", enabled: true }, // no templateId → skipped
          { event: "bogus", channel: "sms", enabled: true, templateId: TEMPLATE_SMS },
        ],
      },
    ]);
    expect(bindings).toHaveLength(2);
    expect(bindings.map((b) => b.channel).sort()).toEqual(["sms", "whatsapp"]);
  });

  it("bindingsForEvent filters by lifecycle event", () => {
    const outputs = [{
      kind: "notifications",
      bindings: [
        { event: "payment_due", channel: "whatsapp", enabled: true, templateId: TEMPLATE_WA },
        { event: "submitted", channel: "sms", enabled: true, templateId: TEMPLATE_SMS },
      ],
    }];
    expect(bindingsForEvent(outputs, "payment_due")).toHaveLength(1);
    expect(bindingsForEvent(outputs, "issued")).toHaveLength(0);
    expect(bindingsForEvent(undefined, "payment_due")).toHaveLength(0);
  });

  it("formatAmountMajor converts paise to major units", () => {
    expect(formatAmountMajor(50000)).toBe("500.00");
    expect(formatAmountMajor(1)).toBe("0.01");
  });

  it("enqueuePackNotifications fans out notification.send with pack templateId + channel", async () => {
    vi.mocked(catalogueRepo.findPublishedByServiceIdTx).mockResolvedValue(
      publishedDef([{
        kind: "notifications",
        bindings: [
          { event: "payment_due", channel: "whatsapp", enabled: true, templateId: TEMPLATE_WA },
          { event: "payment_due", channel: "sms", enabled: true, templateId: TEMPLATE_SMS },
        ],
      }]) as never,
    );

    const tx = {} as never;
    const count = await enqueuePackNotifications(tx, {
      tenantId: TENANT,
      actorId: "actor-1",
      correlationId: "corr-1",
      serviceId: SERVICE_ID,
      lifecycleEvent: "payment_due",
      recipient: "citizen-1",
      recipientId: "citizen-1",
      variables: {
        amount: "500.00",
        pay_link: "/citizen/payments/pay-1/pay",
        app_no: "APP-1",
      },
      eventType: "citizen.payment.due",
    });

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    const payloads = vi.mocked(enqueue).mock.calls.map((c) => c[1].payload as {
      templateId: string;
      channel: string;
      eventType: string;
      variables: Record<string, string>;
    });
    expect(payloads.map((p) => p.templateId).sort()).toEqual([TEMPLATE_SMS, TEMPLATE_WA].sort());
    expect(payloads.every((p) => p.eventType === "citizen.payment.due")).toBe(true);
    expect(payloads.every((p) => p.variables.amount === "500.00")).toBe(true);
    expect(payloads.every((p) => p.variables.pay_link === "/citizen/payments/pay-1/pay")).toBe(true);
    expect(payloads.every((p) => p.variables.service_name === "Trade License")).toBe(true);
    expect(payloads.find((p) => p.channel === "whatsapp")?.templateId).toBe(TEMPLATE_WA);
  });

  it("enqueuePackNotifications no-ops when pack has no bindings", async () => {
    vi.mocked(catalogueRepo.findPublishedByServiceIdTx).mockResolvedValue(
      publishedDef([{ type: "certificate" }]) as never,
    );
    const count = await enqueuePackNotifications({} as never, {
      tenantId: TENANT,
      actorId: "a",
      correlationId: "c",
      serviceId: SERVICE_ID,
      lifecycleEvent: "approved",
      recipient: "citizen-1",
    });
    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueuePackNotifications no-ops when published definition is missing", async () => {
    vi.mocked(catalogueRepo.findPublishedByServiceIdTx).mockResolvedValue(null);
    const count = await enqueuePackNotifications({} as never, {
      tenantId: TENANT,
      actorId: "a",
      correlationId: "c",
      serviceId: SERVICE_ID,
      lifecycleEvent: "submitted",
      recipient: "citizen-1",
    });
    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
